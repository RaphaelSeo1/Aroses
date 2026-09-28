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
};

export type MeteredCallResult = {
  message: Anthropic.Message;
  costUsd: number;
  estCostUsd: number;
  ledgerId: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 20_000;

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const v = (headers as Record<string, unknown>)[name];
  return typeof v === "string" ? v : null;
}

function retryAfterMs(headers: unknown): number {
  const ms = Number(headerValue(headers, "retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = Number(headerValue(headers, "retry-after"));
  if (Number.isFinite(s) && s > 0) return s * 1000;
  return DEFAULT_RATE_LIMIT_DELAY_MS;
}

type Classified = {
  error: Error;
  /** False when Anthropic answered with an HTTP error: that request was not billed. */
  mayHaveBilled: boolean;
};

function classify(err: unknown): Classified {
  const e = err as { name?: string; status?: unknown; headers?: unknown; message?: string };
  const message = e?.message || String(err);
  const status = typeof e?.status === "number" ? e.status : null;

  if (e?.name === "AbortError" || e?.name === "APIUserAbortError") {
    return { error: new AiCallError("AI call aborted", { retryable: false, status: null }), mayHaveBilled: true };
  }
  if (status === 429 || status === 529) {
    return { error: new RateLimitedError(retryAfterMs(e.headers), message), mayHaveBilled: false };
  }
  if (status == null) {
    return { error: new AiCallError(message, { retryable: true, status: null }), mayHaveBilled: true };
  }
  const retryable = status >= 500 || status === 408 || status === 409;
  return { error: new AiCallError(message, { retryable, status }), mayHaveBilled: false };
}

/**
 * The only way the course builder talks to Claude.
 *
 * 1. Refuses if COURSE_BUILD_ENABLED is off or the model has no known price.
 * 2. Reserves the worst case (estimated input + max_tokens of output) against
 *    the build cap and the user's 24-hour cap. If the ledger check fails for
 *    any reason, the call is not made.
 * 3. Sends one request with SDK retries off; retries happen at step level.
 * 4. Settles the ledger row with the real usage. A request that may have
 *    been billed but returned nothing usable keeps its worst-case cost.
 */
export async function meteredClaudeCall(
  deps: MeteredCallDeps,
  ctx: MeteredCallContext,
  request: MeteredRequest,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Streams the response and reports the tool input parsed so far. */
    onToolInput?: (snapshot: unknown) => void;
  } = {}
): Promise<MeteredCallResult> {
  const { store, client, config } = deps;
  if (!config.enabled) throw new CourseBuildDisabledError();

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
    const c = classify(err);
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
