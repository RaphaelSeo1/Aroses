import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cachedSystem, usageTokens, withCachedTail } from "./prompt-cache.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("cachedSystem marks only the stable block", () => {
  const blocks = cachedSystem("stable", "per-turn");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    type: "text",
    text: "stable",
    cache_control: { type: "ephemeral" },
  });
  assert.deepEqual(blocks[1], { type: "text", text: "per-turn" });
  assert.equal(cachedSystem("stable", "").length, 1);
  assert.equal(cachedSystem("stable").length, 1);
});

test("withCachedTail puts one breakpoint on the newest message", () => {
  const out = withCachedTail([
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
    { role: "user", content: "c" },
  ]);
  assert.deepEqual(out[0], { role: "user", content: "a" });
  assert.deepEqual(out[1], { role: "assistant", content: "b" });
  assert.deepEqual(out[2], {
    role: "user",
    content: [{ type: "text", text: "c", cache_control: { type: "ephemeral" } }],
  });
});

test("usageTokens reads cache reads and writes", () => {
  assert.deepEqual(
    usageTokens({
      input_tokens: 12,
      output_tokens: 300,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 200,
    }),
    { inputTokens: 12, outputTokens: 300, cacheReadTokens: 4000, cacheWriteTokens: 200 }
  );
  assert.deepEqual(usageTokens(null), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
});

test("every Rose chat path except calendar uses prompt caching and logs cache tokens", () => {
  for (const file of ["./study-chat.ts", "./review-chat.ts", "./mentored.ts", "./tutor-session.ts"]) {
    const src = read(file);
    assert.match(src, /cachedSystem\(/, `${file} caches its system prompt`);
    assert.match(src, /usageTokens\(/, `${file} logs cache tokens`);
  }
  assert.doesNotMatch(read("./calendar-chat.ts"), /cache_control|cachedSystem/);
});

test("conversation paths trim history server-side", () => {
  assert.match(read("../../app/api/study-chat/route.ts"), /trimChatHistory\(/);
  const tutor = read("./tutor-session.ts");
  assert.match(tutor, /trimChatHistory\(/);
  assert.doesNotMatch(tutor, /history\.slice\(-32\)/);
});

test("usage ledger stores cache tokens with a pre-migration fallback", () => {
  const src = read("../billing/ai-usage.ts");
  assert.match(src, /cache_read_input_tokens/);
  assert.match(src, /cache_creation_input_tokens/);
  assert.match(src, /PGRST204/);
  const migration = read("../../../supabase/migrations/121_ai_usage_cache_tokens.sql");
  assert.match(migration, /add column if not exists cache_read_input_tokens/);
});
