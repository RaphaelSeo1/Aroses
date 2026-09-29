import assert from "node:assert/strict";
import test from "node:test";
import { readCourseBuildConfig } from "./config.ts";
import {
  actualCostUsd,
  buildSpendCapUsd,
  dailyCapUsdForTier,
  estimateInputTokens,
  estimateTextTokens,
  modelPrice,
  worstCaseCostUsd,
} from "./pricing.ts";

test("config defaults: off, Haiku 4.5, 200 tokens/page, $0.0025/page, $0.06 floor", () => {
  const c = readCourseBuildConfig({});
  assert.equal(c.enabled, false);
  assert.equal(c.model, "claude-haiku-4-5");
  assert.equal(c.outputTokensPerPage, 200);
  assert.equal(c.capUsdPerPage, 0.0025);
  assert.equal(c.minCapUsd, 0.06);
  assert.equal(c.maxStepAttempts, 3);
  assert.equal(readCourseBuildConfig({ COURSE_BUILD_ENABLED: "true" }).enabled, true);
  assert.equal(readCourseBuildConfig({ COURSE_BUILD_ENABLED: "yes please" }).enabled, false);
  assert.equal(readCourseBuildConfig({ COURSE_BUILD_CAP_USD_PER_PAGE: "-1" }).capUsdPerPage, 0.0025);
});

test("build cap is pages × per-page cap with a floor", () => {
  const c = readCourseBuildConfig({});
  assert.equal(buildSpendCapUsd(40, c), 0.1);
  assert.equal(buildSpendCapUsd(3, c), 0.06);
  assert.equal(buildSpendCapUsd(0, c), 0.06);
  assert.equal(buildSpendCapUsd(Number.NaN, c), 0.06);
});

test("daily build spend cap follows the tier; COURSE_BUILD_DAILY_CAP_USD is a ceiling", () => {
  const c = readCourseBuildConfig({});
  assert.equal(c.dailyCapCeilingUsd, null);
  assert.equal(dailyCapUsdForTier("lite", c), 1);
  assert.equal(dailyCapUsdForTier("student", c), 1.5);
  assert.equal(dailyCapUsdForTier("plus", c), 3);
  assert.equal(dailyCapUsdForTier("pro", c), 5);
  assert.equal(dailyCapUsdForTier("max", c), 8);
  // Old tier names use the mapped tier's cap.
  assert.equal(dailyCapUsdForTier("advanced", c), 3);
  assert.equal(dailyCapUsdForTier("premium", c), 5);
  // Free can't build; the DB still needs a positive cap on the row.
  assert.equal(dailyCapUsdForTier("free", c), c.minCapUsd);
  assert.ok(dailyCapUsdForTier("free", c, { unlimited: true }) >= 8);

  const ceiling = readCourseBuildConfig({ COURSE_BUILD_DAILY_CAP_USD: "2" });
  assert.equal(ceiling.dailyCapCeilingUsd, 2);
  assert.equal(dailyCapUsdForTier("lite", ceiling), 1);
  assert.equal(dailyCapUsdForTier("max", ceiling), 2);
  assert.equal(dailyCapUsdForTier("max", ceiling, { unlimited: true }), 2);
});

test("model prices match Anthropic's published Haiku 4.5 rates", () => {
  const p = modelPrice("claude-haiku-4-5")!;
  assert.deepEqual(p, { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 });
  assert.deepEqual(modelPrice("claude-haiku-4-5-20251001"), p);
  assert.equal(modelPrice("claude-haiku-4"), null);
  assert.equal(modelPrice("gpt-4o"), null);
});

test("costs include cache tokens and round up", () => {
  const p = modelPrice("claude-haiku-4-5")!;
  assert.equal(
    actualCostUsd(p, { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10_000 }),
    1.50225
  );
  assert.equal(worstCaseCostUsd(p, 3000, 1600), 0.011);
  assert.equal(actualCostUsd(p, {}), 0);
});

test("token estimates over-count English and Korean", () => {
  const english = "The demand curve slopes downward because of diminishing marginal utility. ".repeat(20);
  // Real Claude rate for English prose is ~4 chars/token.
  assert.ok(estimateTextTokens(english) >= english.length / 4);
  const korean = "약물의 흡수는 위장관에서 일어난다".repeat(20);
  // Korean runs ~1–1.5 chars/token; one token per non-ASCII char covers it.
  assert.ok(estimateTextTokens(korean) >= korean.replace(/\s/g, "").length);
});

test("input estimate counts system, messages, tools and images", () => {
  const base = estimateInputTokens({ messages: [{ role: "user", content: "hi" }] });
  const withTools = estimateInputTokens({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "write_module", input_schema: { type: "object" } }],
  });
  assert.ok(withTools - base >= 600, "tool-use system prompt overhead");
  const withImage = estimateInputTokens({
    messages: [{ role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "hi" }] }],
  });
  assert.ok(withImage - base >= 1500);
});
