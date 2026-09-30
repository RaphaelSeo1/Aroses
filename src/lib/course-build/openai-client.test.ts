import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createOpenAiMessagesClient,
  isOpenAiCourseBuildModel,
  parseToolArguments,
  readOpenAiSse,
  toAnthropicMessage,
  toOpenAiChatBody,
  tryParsePartialJson,
  usageFromOpenAi,
} from "./openai-client.ts";
import { actualCostUsd, modelPrice } from "./pricing.ts";
import { PLAN_TOOL } from "./prompts.ts";

test("gpt-5.6-luna is an OpenAI course-build model; Haiku is not", () => {
  assert.equal(isOpenAiCourseBuildModel("gpt-5.6-luna"), true);
  assert.equal(isOpenAiCourseBuildModel("claude-haiku-4-5"), false);
});

test("Anthropic tool requests become OpenAI function tools with reasoning off", () => {
  const body = toOpenAiChatBody({
    model: "gpt-5.6-luna",
    max_tokens: 800,
    system: "Write a plan.",
    messages: [{ role: "user", content: [{ type: "text", text: "p1 Cell division" }] }],
    tools: [PLAN_TOOL],
    tool_choice: { type: "tool", name: PLAN_TOOL.name },
  } as Anthropic.MessageCreateParamsNonStreaming);

  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.max_completion_tokens, 800);
  assert.equal((body.messages[0] as { role: string }).role, "system");
  const tool = (body.tools?.[0] as { function: { name: string; strict: boolean } }).function;
  assert.equal(tool.name, "submit_plan");
  assert.equal(tool.strict, true);
  assert.deepEqual(body.tool_choice, { type: "function", function: { name: "submit_plan" } });
});

test("JPEG blocks become data-URL image parts", () => {
  const body = toOpenAiChatBody({
    model: "gpt-5.6-luna",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Review:" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "abc" } },
        ],
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);
  const parts = (body.messages[0] as { content: Array<{ type: string; image_url?: { url: string } }> }).content;
  assert.equal(parts[1]?.type, "image_url");
  assert.equal(parts[1]?.image_url?.url, "data:image/jpeg;base64,abc");
});

test("OpenAI tool calls map back to Anthropic tool_use with usage", () => {
  const msg = toAnthropicMessage(
    "gpt-5.6-luna",
    "chatcmpl_1",
    [{ id: "c1", function: { name: "submit_plan", arguments: '{"title":"X"}' } }],
    "",
    {
      input_tokens: 100,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 20,
    } as Anthropic.Usage
  );
  assert.equal(msg.stop_reason, "tool_use");
  const block = msg.content[0] as Anthropic.ToolUseBlock;
  assert.equal(block.name, "submit_plan");
  assert.deepEqual(block.input, { title: "X" });
  assert.equal(msg.usage.cache_read_input_tokens, 20);
});

test("partial tool arguments parse into the object written so far, for the live preview", () => {
  assert.equal(tryParsePartialJson(""), undefined);
  assert.deepEqual(tryParsePartialJson('{"a":1}'), { a: 1 });
  assert.deepEqual(tryParsePartialJson('{"lessons":[{"title":"Nuclear pores","content":"Large struc'), {
    lessons: [{ title: "Nuclear pores" }],
  });
  assert.deepEqual(parseToolArguments(""), {});
});

test("cached prompt tokens are billed once, at the cached rate", () => {
  const usage = usageFromOpenAi({ prompt_tokens: 10_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 8_000 } });
  assert.equal(usage.input_tokens, 2_000);
  assert.equal(usage.cache_read_input_tokens, 8_000);
  const price = modelPrice("gpt-5.6-luna")!;
  // 2,000 × $0.20 + 8,000 × $0.02 + 1,000 × $1.20 per million
  assert.equal(actualCostUsd(price, usage), 0.00176);
});

test("a response cut off at max_completion_tokens reads as max_tokens, so the step retries", () => {
  const msg = toAnthropicMessage(
    "gpt-5.6-luna",
    "c",
    [{ id: "c1", function: { name: "submit_module", arguments: '{"lessons":[{"title":"A' } }],
    "",
    usageFromOpenAi({ prompt_tokens: 10, completion_tokens: 10 }),
    "length"
  );
  assert.equal(msg.stop_reason, "max_tokens");
});

function sseResponse(chunks: unknown[], opts: { end?: boolean } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      if (opts.end !== false) c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const argDelta = (s: string) => ({ id: "c", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: s } }] } }] });

test("a streamed module shows lessons before the response finishes, then settles with usage", async () => {
  const snapshots: unknown[] = [];
  let t = 0;
  const res = sseResponse([
    { id: "c", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "submit_module", arguments: "" } }] } }] },
    argDelta('{"lessons":[{"title":"Pores",'),
    argDelta('"content":"Nups self-assemble into pores"},'),
    argDelta('{"title":"Import"'),
    argDelta("}]}"),
    { id: "c", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { id: "c", choices: [], usage: { prompt_tokens: 500, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 100 } } },
  ]);
  const msg = await readOpenAiSse(res, "gpt-5.6-luna", (s) => snapshots.push(s), () => (t += 1_000));
  assert.deepEqual(snapshots[0], { lessons: [{ title: "Pores" }] });
  assert.deepEqual(snapshots[1], { lessons: [{ title: "Pores", content: "Nups self-assemble into pores" }] });
  assert.deepEqual(snapshots.at(-1), {
    lessons: [{ title: "Pores", content: "Nups self-assemble into pores" }, { title: "Import" }],
  });
  assert.equal(msg.stop_reason, "tool_use");
  assert.deepEqual((msg.content[0] as Anthropic.ToolUseBlock).input, snapshots.at(-1));
  assert.equal(msg.usage.input_tokens, 400);
  assert.equal(msg.usage.cache_read_input_tokens, 100);
});

test("a stream that ends before its usage arrives fails instead of settling at $0", async () => {
  const res = sseResponse([argDelta('{"lessons":[')], { end: false });
  await assert.rejects(readOpenAiSse(res, "gpt-5.6-luna", () => {}), /ended before/);
});

test("a stalled stream times out as a retryable error; the caller's abort stays an abort", async () => {
  const realFetch = globalThis.fetch;
  // Like real fetch: headers arrive, the body never does, and an abort errors the body.
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    const client = createOpenAiMessagesClient("k");
    const body = { model: "gpt-5.6-luna", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } as Anthropic.MessageCreateParamsNonStreaming;
    await assert.rejects(client.messages.stream!(body, { timeout: 30 }).finalMessage(), (e: Error) => e.name === "TimeoutError");
    const ac = new AbortController();
    const p = client.messages.stream!(body, { timeout: 5_000, signal: ac.signal }).finalMessage();
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(p, (e: Error) => e.name === "APIUserAbortError");
  } finally {
    globalThis.fetch = realFetch;
  }
});
