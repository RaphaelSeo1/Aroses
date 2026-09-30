import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "./metered-call.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

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

export function tryParsePartialJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function usageFromOpenAi(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
} | undefined): Anthropic.Usage {
  const input = usage?.prompt_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: input,
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
  usage: Anthropic.Usage
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
    stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
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

async function openAiPost(
  apiKey: string,
  payload: OpenAiChatRequest,
  options?: RequestOptions
): Promise<Response> {
  const timeout = options?.timeout ?? 120_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const onAbort = () => ac.abort();
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
    return res;
  } catch (err) {
    if (err instanceof OpenAiHttpError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      const e = new Error("AI call aborted");
      e.name = options?.signal?.aborted ? "APIUserAbortError" : "AbortError";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

async function readOpenAiSse(
  res: Response,
  model: string,
  onSnapshot: (snapshot: unknown) => void
): Promise<Anthropic.Message> {
  if (!res.body) throw new Error("OpenAI stream had no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let id = "msg_openai";
  let text = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let usage: Anthropic.Usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  } as Anthropic.Usage;

  const emit = () => {
    const first = [...calls.values()][0];
    if (!first?.arguments) return;
    const snap = tryParsePartialJson(first.arguments);
    if (snap !== undefined) onSnapshot(snap);
  };

  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: {
        id?: string;
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.id) id = parsed.id;
      const delta = parsed.choices?.[0]?.delta;
      if (typeof delta?.content === "string") text += delta.content;
      for (const tc of delta?.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) ?? { id: "", name: "", arguments: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
        calls.set(i, cur);
        emit();
      }
      if (parsed.usage) usage = usageFromOpenAi(parsed.usage);
    }
  }
  const toolCalls = [...calls.values()].map((c) => ({
    id: c.id,
    function: { name: c.name, arguments: c.arguments },
  }));
  return toAnthropicMessage(model, id, toolCalls, text, usage);
}

/**
 * Anthropic-shaped client backed by OpenAI chat completions. Used when
 * COURSE_BUILD_MODEL is a GPT model so handlers and the ledger stay unchanged.
 */
export function createOpenAiMessagesClient(apiKey: string): MessagesClient {
  return {
    messages: {
      async create(body, options) {
        const payload = toOpenAiChatBody(body);
        const res = await openAiPost(apiKey, payload, options);
        const json = (await res.json()) as {
          id?: string;
          choices?: Array<{
            message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
        };
        const msg = json.choices?.[0]?.message;
        return toAnthropicMessage(
          body.model,
          json.id ?? "msg_openai",
          msg?.tool_calls ?? [],
          msg?.content ?? "",
          usageFromOpenAi(json.usage)
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
            pending ??= (async () => {
              const payload = { ...toOpenAiChatBody(body), stream: true, stream_options: { include_usage: true } };
              const res = await openAiPost(apiKey, payload, options);
              return readOpenAiSse(res, body.model, snapshotFn);
            })();
            return pending;
          },
        };
      },
    },
  };
}
