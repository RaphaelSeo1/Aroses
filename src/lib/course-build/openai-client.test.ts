import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  isOpenAiCourseBuildModel,
  parseToolArguments,
  toAnthropicMessage,
  toOpenAiChatBody,
  tryParsePartialJson,
} from "./openai-client.ts";
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

test("partial JSON snapshots are only emitted when they parse", () => {
  assert.equal(tryParsePartialJson('{"a":'), undefined);
  assert.deepEqual(tryParsePartialJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolArguments(""), {});
});
