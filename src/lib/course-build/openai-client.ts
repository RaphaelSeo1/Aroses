import type Anthropic from "@anthropic-ai/sdk";
import { partialParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser";
import type { MessagesClient } from "./metered-call.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** Re-parse the growing tool arguments at most this often; each parse reads the whole string. */
const SNAPSHOT_INTERVAL_MS = 250;

export function isOpenAiCourseBuildModel(model: string): boolean {
  const id = model.trim().toLowerCase();
  return id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4");
}

type RequestOptions = { signal?: AbortSignal; maxRetries?: number; timeout?: number };

type OpenAiToolCall = { id?: string; function?: { name?: string; arguments?: string } };

export type OpenAiChatRequest = {
  model: string;
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_completion_tokens: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  reasoning_effort?: string;
};

export function toOpenAiChatBody(body: Anthropic.MessageCreateParamsNonStreaming): OpenAiChatRequest {
  const messages = [
    ...systemMessages(body.system),
    ...body.messages.flatMap(toOpenAiMessage),
  ];
  const tools = (body.tools ?? []).map(toOpenAiTool);
  const out: OpenAiChatRequest = {
    model: body.model,
    messages,
    max_completion_tokens: body.max_tokens,
    reasoning_effort: "none",
  };
  if (tools.length > 0) {
    out.tools = tools;
    out.tool_choice = toOpenAiToolChoice(body.tool_choice, tools);
  }
  return out;
}

function systemMessages(system: Anthropic.MessageCreateParamsNonStreaming["system"]): Array<{ role: "system"; content: string }> {
  if (!system) return [];
  if (typeof system === "string") return system.trim() ? [{ role: "system", content: system }] : [];
  const text = system
    .map((b) => (b && typeof b === "object" && "text" in b && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
  return text ? [{ role: "system", content: text }] : [];
}

function toOpenAiMessage(m: Anthropic.MessageParam): Array<{ role: string; content: unknown }> {
  const role = m.role === "assistant" ? "assistant" : "user";
  if (typeof m.content === "string") return [{ role, content: m.content }];
  const parts: unknown[] = [];
  for (const block of m.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; source?: { type?: string; media_type?: string; data?: string } };
    if (b.type === "text" && typeof b.text === "string") parts.push({ type: "text", text: b.text });
    else if (b.type === "image" && b.source?.type === "base64" && b.source.data) {
      const media = b.source.media_type || "image/jpeg";
      parts.push({ type: "image_url", image_url: { url: `data:${media};base64,${b.source.data}` } });
    }
  }
  return [{ role, content: parts.length === 1 && (parts[0] as { type?: string }).type === "text" ? (parts[0] as { text: string }).text : parts }];
}

function toOpenAiTool(tool: Anthropic.ToolUnion): { type: "function"; function: Record<string, unknown> } {
  const t = tool as Anthropic.Tool;
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema ?? { type: "object", properties: {} },
      strict: t.strict === true,
    },
  };
}

function toOpenAiToolChoice(
  choice: Anthropic.MessageCreateParamsNonStreaming["tool_choice"],
  tools: Array<{ function: { name?: string } }>
): unknown {
  if (!choice) return "auto";
  if (typeof choice === "string") {
    if (choice === "auto") return "auto";
    const name = tools[0]?.function?.name;
    return name ? { type: "function", function: { name } } : "required";
  }
  if (choice.type === "tool" && "name" in choice) {
    return { type: "function", function: { name: choice.name } };
  }
  return "required";
}

export function parseToolArguments(raw: string): unknown {
  const text = raw.trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

/** The object streamed so far, with unfinished strings and arrays closed; undefined before the first key. */
export function tryParsePartialJson(raw: string): unknown | undefined {
  if (!raw.trim()) return undefined;
  try {
    return partialParse(raw);
  } catch {
    return undefined;
  }
}

/** OpenAI counts cached tokens inside prompt_tokens; Anthropic (and the ledger) keep them apart. */
export function usageFromOpenAi(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
} | undefined): Anthropic.Usage {
  const prompt = usage?.prompt_tokens ?? 0;
  const cached = Math.min(prompt, usage?.prompt_tokens_details?.cached_tokens ?? 0);
  return {
    input_tokens: prompt - cached,
    output_tokens: usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  } as Anthropic.Usage;
}

export function toAnthropicMessage(
  model: string,
  id: string,
  toolCalls: OpenAiToolCall[],
  text: string,
  usage: Anthropic.Usage,
  finishReason?: string | null
): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];
  if (toolCalls.length === 0 && text) {
    content.push({ type: "text", text, citations: null });
  }
  for (const call of toolCalls) {
    content.push({
      type: "tool_use",
      id: call.id || "call_0",
      name: call.function?.name || "unknown",
      input: parseToolArguments(call.function?.arguments ?? ""),
    } as Anthropic.ToolUseBlock);
  }
  if (content.length === 0) content.push({ type: "text", text: text || "", citations: null });
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: finishReason === "length" ? "max_tokens" : toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage,
  } as Anthropic.Message;
}

class OpenAiHttpError extends Error {
  status: number;
  headers: Headers;
  constructor(status: number, message: string, headers: Headers) {
    super(message);
    this.name = "OpenAiHttpError";
    this.status = status;
    this.headers = headers;
  }
}

type OpenAiResponseChunk = {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

/**
 * Sends one request and hands the response to `read`. The timeout and the
 * caller's abort signal cover the whole exchange, body included, so a stalled
 * stream is cut off and a canceled build stops paying for tokens.
 */
async function openAiRequest<T>(
  apiKey: string,
  payload: OpenAiChatRequest,
  options: RequestOptions | undefined,
  read: (res: Response) => Promise<T>
): Promise<T> {
  const timeout = options?.timeout ?? 120_000;
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeout);
  const onAbort = () => ac.abort();
  if (options?.signal?.aborted) ac.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new OpenAiHttpError(res.status, detail.slice(0, 400) || `OpenAI ${res.status}`, res.headers);
    }
    return await read(res);
  } catch (err) {
    if (err instanceof OpenAiHttpError) throw err;
    if (ac.signal.aborted) {
      // A timeout is retried like a dropped connection; only the caller's abort stops the step.
      const e = new Error(timedOut ? `OpenAI request timed out after ${timeout}ms` : "AI call aborted");
      e.name = timedOut ? "TimeoutError" : "APIUserAbortError";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

export async function readOpenAiSse(
  res: Response,
  model: string,
  onSnapshot: (snapshot: unknown) => void,
  now: () => number = Date.now
): Promise<Anthropic.Message> {
  if (!res.body) throw new Error("OpenAI stream had no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let id = "msg_openai";
  let text = "";
  let finishReason: string | null = null;
  let sawUsage = false;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let usage: Anthropic.Usage = usageFromOpenAi(undefined);
  let lastSnapshotAt = -Infinity;
  let snapshotLength = 0;

  const emit = (force: boolean) => {
    const first = [...calls.values()][0];
    if (!first?.arguments || first.arguments.length === snapshotLength) return;
    if (!force && now() - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshotAt = now();
    snapshotLength = first.arguments.length;
    const snap = tryParsePartialJson(first.arguments);
    if (snap !== undefined) onSnapshot(snap);
  };

  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let parsed: OpenAiResponseChunk & { error?: { message?: string } };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.error) throw new Error(`OpenAI stream error: ${parsed.error.message ?? "unknown"}`);
    if (parsed.id) id = parsed.id;
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (typeof delta?.content === "string") text += delta.content;
    for (const tc of delta?.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const cur = calls.get(i) ?? { id: "", name: "", arguments: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
      calls.set(i, cur);
    }
    if (delta?.tool_calls?.length) emit(false);
    if (parsed.usage) {
      usage = usageFromOpenAi(parsed.usage);
      sawUsage = true;
    }
  };

  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      handle(buf.slice(0, nl).trim());
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  }
  handle(buf.trim());
  // The ledger settles on usage; a stream cut before it can't be priced and is retried at worst case.
  if (!finishReason || !sawUsage) throw new Error("OpenAI stream ended before the response finished");
  emit(true);
  const toolCalls = [...calls.values()].map((c) => ({
    id: c.id,
    function: { name: c.name, arguments: c.arguments },
  }));
  return toAnthropicMessage(model, id, toolCalls, text, usage, finishReason);
}

/**
 * Anthropic-shaped client backed by OpenAI chat completions. Used when
 * COURSE_BUILD_MODEL is a GPT model so handlers and the ledger stay unchanged.
 */
export function createOpenAiMessagesClient(apiKey: string): MessagesClient {
  return {
    messages: {
      async create(body, options) {
        const json = await openAiRequest(apiKey, toOpenAiChatBody(body), options, (res) => res.json() as Promise<OpenAiResponseChunk>);
        const choice = json.choices?.[0];
        return toAnthropicMessage(
          body.model,
          json.id ?? "msg_openai",
          choice?.message?.tool_calls ?? [],
          choice?.message?.content ?? "",
          usageFromOpenAi(json.usage),
          choice?.finish_reason
        );
      },
      stream(body, options) {
        let pending: Promise<Anthropic.Message> | null = null;
        let snapshotFn: (snapshot: unknown) => void = () => {};
        return {
          on(event, listener) {
            if (event === "inputJson") {
              snapshotFn = (snapshot) => {
                try {
                  listener("", snapshot);
                } catch {
                  /* preview must never fail the call */
                }
              };
            }
            return this;
          },
          finalMessage() {
            pending ??= openAiRequest(
              apiKey,
              { ...toOpenAiChatBody(body), stream: true, stream_options: { include_usage: true } },
              options,
              (res) => readOpenAiSse(res, body.model, snapshotFn)
            );
            return pending;
          },
        };
      },
    },
  };
}

