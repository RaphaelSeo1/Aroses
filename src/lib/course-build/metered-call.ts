import type Anthropic from "@anthropic-ai/sdk";
import type { CourseBuildConfig } from "./config.ts";
import {
  AiCallError,
  BudgetUnavailableError,
  CourseBuildDisabledError,
  RateLimitedError,
  SpendRefusedError,
  type SpendRefusalReason,
} from "./errors.ts";
import { actualCostUsd, estimateInputTokens, modelPrice, worstCaseCostUsd } from "./pricing.ts";
import type { CourseBuildStore } from "./store.ts";

export type MeteredRequest = Omit<Anthropic.MessageCreateParamsNonStreaming, "model" | "stream">;

type RequestOptions = { signal?: AbortSignal; maxRetries?: number; timeout?: number };

/** The slice of the SDK's MessageStream the builder uses. */
export type MessageStreamLike = {
  on(event: "inputJson", listener: (partialJson: string, snapshot: unknown) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
};

export type MessagesClient = {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: RequestOptions): PromiseLike<Anthropic.Message>;
    stream?(body: Anthropic.MessageCreateParamsNonStreaming, options?: RequestOptions): MessageStreamLike;
  };
};

export type MeteredCallContext = {
  buildId: string;
  stepId: string | null;
  userId: string;
  /** Short label for the ledger, e.g. "plan", "module:3", "vision:crop". */
  purpose: string;
};

export type MeteredCallDeps = {
  store: CourseBuildStore;
  client: MessagesClient;
  config: CourseBuildConfig;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Waits between quick retries; resolves early when the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export type MeteredCallResult = {
  message: Anthropic.Message;
  costUsd: number;
  estCostUsd: number;
  ledgerId: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 20_000;
/** Reschedule delay after an overload when the server names none: short, jittered. */
const OVERLOAD_RESCHEDULE_MS: [number, number] = [3_000, 8_000];
/** Jittered waits before each quick in-call retry of an overloaded call. */
const QUICK_RETRY_MS: Array<[number, number]> = [
  [500, 1_500],
  [1_500, 4_000],
];
/** After the structured-output service fails, strict tool schemas are skipped for this long. */
const STRICT_OUTAGE_MS = 5 * 60_000;

let strictOutageUntil = 0;

/** True while calls skip strict tool schemas because structured output recently failed. */
export function structuredOutputOutage(now = Date.now()): boolean {
  return now < strictOutageUntil;
}

export function resetStructuredOutputOutage(): void {
  strictOutageUntil = 0;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const v = (headers as Record<string, unknown>)[name];
  return typeof v === "string" ? v : null;
}

function serverRetryAfterMs(headers: unknown): number | null {
  const ms = Number(headerValue(headers, "retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = Number(headerValue(headers, "retry-after"));
  if (Number.isFinite(s) && s > 0) return s * 1000;
  return null;
}

function jitter(random: () => number, [lo, hi]: [number, number]): number {
  return Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, random())));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

type Classified = {
  error: Error;
  /** False when Anthropic answered with an HTTP error: that request was not billed. */
  mayHaveBilled: boolean;
};

function classify(err: unknown, random: () => number): Classified {
  const e = err as { name?: string; status?: unknown; headers?: unknown; message?: string };
  const message = e?.message || String(err);
  const status = typeof e?.status === "number" ? e.status : null;

  if (e?.name === "AbortError" || e?.name === "APIUserAbortError") {
    return { error: new AiCallError("AI call aborted", { retryable: false, status: null }), mayHaveBilled: true };
  }
  if (status === 429) {
    const ms = serverRetryAfterMs(e.headers) ?? DEFAULT_RATE_LIMIT_DELAY_MS;
    return { error: new RateLimitedError(ms, message, "rate_limit"), mayHaveBilled: false };
  }
  if (status === 529 || status === 503 || (status != null && status >= 500 && /overloaded_error/.test(message))) {
    // e.g. 503 overloaded_error "Grammar compilation is temporarily unavailable."
    const reason = /grammar/i.test(message) ? "structured_output" : "overloaded";
    const ms = serverRetryAfterMs(e.headers) ?? jitter(random, OVERLOAD_RESCHEDULE_MS);
    return { error: new RateLimitedError(ms, message, reason), mayHaveBilled: false };
  }
  if (status == null) {
    return { error: new AiCallError(message, { retryable: true, status: null }), mayHaveBilled: true };
  }
  const retryable = status >= 500 || status === 408 || status === 409;
  return { error: new AiCallError(message, { retryable, status }), mayHaveBilled: false };
}

/**
 * The only way the course builder talks to the configured model.
 *
 * 1. Refuses if COURSE_BUILD_ENABLED is off or the model has no known price.
 * 2. Reserves the worst case (estimated input + max_tokens of output) against
 *    the build cap and the user's 24-hour cap. If the ledger check fails for
 *    any reason, the call is not made.
 * 3. Sends the request with SDK retries off. Only an overloaded service is
 *    retried here, quickly and at most twice, dropping strict tool schemas when
 *    structured output is what failed; anything else is retried at step level.
 * 4. Settles the ledger row with the real usage. A request that may have
 *    been billed but returned nothing usable keeps its worst-case cost.
 */
export async function meteredClaudeCall(
  deps: MeteredCallDeps,
  ctx: MeteredCallContext,
  request: MeteredRequest,
  opts: CallOptions = {}
): Promise<MeteredCallResult> {
  if (!deps.config.enabled) throw new CourseBuildDisabledError();
  const sleep = deps.sleep ?? abortableSleep;
  const random = deps.random ?? Math.random;
  const strictTools = (request.tools ?? []).some((t) => (t as { strict?: boolean }).strict === true);
  let relaxed = strictTools && structuredOutputOutage();

  for (let retry = 0; ; retry++) {
    try {
      return await callOnce(deps, ctx, relaxed ? withoutStrict(request) : request, opts, random);
    } catch (err) {
      if (!(err instanceof RateLimitedError) || err.reason === "rate_limit" || retry >= QUICK_RETRY_MS.length) throw err;
      if (opts.signal?.aborted) throw err;
      if (err.reason === "structured_output") strictOutageUntil = Date.now() + STRICT_OUTAGE_MS;
      // Structured output down, or overloaded twice: the schema-free tool call still validates downstream.
      if (strictTools && (err.reason === "structured_output" || retry >= 1)) relaxed = true;
      deps.log?.("course-build AI busy, retrying", {
        buildId: ctx.buildId,
        purpose: ctx.purpose,
        reason: err.reason,
        retry: retry + 1,
        strict: strictTools && !relaxed,
      });
      await sleep(jitter(random, QUICK_RETRY_MS[retry]!), opts.signal);
      if (opts.signal?.aborted) throw new AiCallError("AI call aborted", { retryable: false, status: null });
    }
  }
}

type CallOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Streams the response and reports the tool input parsed so far. */
  onToolInput?: (snapshot: unknown) => void;
};

/** The same tools without `strict`, so the API skips structured-output grammar compilation. */
function withoutStrict(request: MeteredRequest): MeteredRequest {
  return {
    ...request,
    tools: request.tools?.map((t) => {
      const rest = { ...(t as Anthropic.Tool) };
      delete rest.strict;
      return rest as Anthropic.ToolUnion;
    }),
  };
}

async function callOnce(
  deps: MeteredCallDeps,
  ctx: MeteredCallContext,
  request: MeteredRequest,
  opts: CallOptions,
  random: () => number
): Promise<MeteredCallResult> {
  const { store, client, config } = deps;

  const model = config.model;
  const price = modelPrice(model);
  if (!price) throw new BudgetUnavailableError(`no price for model ${model}`);

  const maxTokens = Math.floor(request.max_tokens);
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new BudgetUnavailableError("max_tokens must be a positive integer");
  }

  const estInput = estimateInputTokens({
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  });
  const estCostUsd = worstCaseCostUsd(price, estInput, maxTokens);

  let reservation;
  try {
    reservation = await store.reserveSpend({
      buildId: ctx.buildId,
      stepId: ctx.stepId,
      userId: ctx.userId,
      purpose: ctx.purpose,
      model,
      maxOutputTokens: maxTokens,
      estCostUsd,
    });
  } catch (err) {
    throw new BudgetUnavailableError(err instanceof Error ? err.message : String(err));
  }
  if (!reservation.ok) {
    throw new SpendRefusedError((reservation.reason ?? "build_cap") as SpendRefusalReason);
  }
  if (opts.signal?.aborted) {
    await settleQuietly(deps, reservation.ledgerId, "failed", 0, null);
    throw new AiCallError("AI call aborted", { retryable: false, status: null });
  }

  let message: Anthropic.Message;
  try {
    const body = { ...request, model, max_tokens: maxTokens, stream: false } as const;
    const options = { signal: opts.signal, maxRetries: 0, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS };
    const onToolInput = opts.onToolInput;
    if (onToolInput && client.messages.stream) {
      const stream = client.messages.stream(body, options);
      stream.on("inputJson", (_delta, snapshot) => {
        try {
          onToolInput(snapshot);
        } catch {
          // A preview problem must never fail the call.
        }
      });
      message = await stream.finalMessage();
    } else {
      message = await client.messages.create(body, options);
    }
  } catch (err) {
    const c = classify(err, random);
    await settleQuietly(deps, reservation.ledgerId, "failed", c.mayHaveBilled ? estCostUsd : 0, null);
    throw c.error;
  }

  const costUsd = actualCostUsd(price, message.usage ?? {});
  await settleQuietly(deps, reservation.ledgerId, "settled", costUsd, message.usage ?? null);
  return { message, costUsd, estCostUsd, ledgerId: reservation.ledgerId };
}

/**
 * A failed settle leaves the row "reserved", which keeps counting at its
 * worst-case estimate. That over-counts, never under-counts.
 */
async function settleQuietly(
  deps: MeteredCallDeps,
  ledgerId: string,
  status: "settled" | "failed",
  costUsd: number,
  usage: Anthropic.Usage | null
): Promise<void> {
  try {
    await deps.store.settleSpend({
      ledgerId,
      status,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      costUsd,
    });
  } catch (err) {
    deps.log?.("course-build settle failed", {
      ledgerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
