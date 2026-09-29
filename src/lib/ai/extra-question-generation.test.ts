import assert from "node:assert/strict";
import test from "node:test";
import { ANTHROPIC_HAIKU } from "./anthropic-models.ts";
import {
  APPEND_QUIZ_MAX_COUNT,
  EXTRA_QUESTION_MAX_TOKENS,
  EXTRA_QUESTION_REPAIR_MAX_TOKENS,
  clampAppendQuizCount,
  extraQuestionModel,
} from "./extra-question-generation.ts";
import {
  stripChoiceLetterPrefixes,
  stripCorrectLetterPrefix,
} from "./quiz-choice-letters.ts";

test("both question tools default to Haiku; env overrides", () => {
  assert.equal(extraQuestionModel({}), ANTHROPIC_HAIKU);
  assert.equal(extraQuestionModel({ ANTHROPIC_EXTRA_QUESTIONS_MODEL: "  " }), ANTHROPIC_HAIKU);
  assert.equal(
    extraQuestionModel({ ANTHROPIC_EXTRA_QUESTIONS_MODEL: "claude-sonnet-4-6" }),
    "claude-sonnet-4-6"
  );
});

test("output budgets are bounded", () => {
  assert.equal(EXTRA_QUESTION_MAX_TOKENS, 4096);
  assert.ok(EXTRA_QUESTION_REPAIR_MAX_TOKENS <= EXTRA_QUESTION_MAX_TOKENS);
});

test("generate-more count is clamped to what the UI sends (8)", () => {
  assert.equal(APPEND_QUIZ_MAX_COUNT, 8);
  assert.equal(clampAppendQuizCount(8), 8);
  assert.equal(clampAppendQuizCount(16), 8);
  assert.equal(clampAppendQuizCount(10_000), 8);
  assert.equal(clampAppendQuizCount(6.9), 6);
  assert.equal(clampAppendQuizCount(1), 4);
  assert.equal(clampAppendQuizCount(-3), 4);
  assert.equal(clampAppendQuizCount(undefined), 8);
  assert.equal(clampAppendQuizCount("100"), 8);
  assert.equal(clampAppendQuizCount(Number.NaN), 8);
  assert.equal(clampAppendQuizCount(Number.POSITIVE_INFINITY), 8);
});

test("A)–D) choice prefixes are stripped only when all four carry them in order", () => {
  assert.deepEqual(
    stripChoiceLetterPrefixes(["A) Mitosis", "B) Meiosis", "C) Fission", "D) Budding"]),
    ["Mitosis", "Meiosis", "Fission", "Budding"]
  );
  assert.deepEqual(
    stripChoiceLetterPrefixes(["A. one", "B. two", "C. three", "D. four"]),
    ["one", "two", "three", "four"]
  );
  assert.deepEqual(
    stripChoiceLetterPrefixes(["(a) one", "(b) two", "(c) three", "(d) four"]),
    ["one", "two", "three", "four"]
  );
  const real = ["A. thaliana", "E. coli", "S. cerevisiae", "D. melanogaster"];
  assert.equal(stripChoiceLetterPrefixes(real), real);
  const plain = ["Hemoglobin", "Insulin", "Keratin", "Pepsin"];
  assert.equal(stripChoiceLetterPrefixes(plain), plain);
});

test("a full-text correct answer loses the same prefix; a bare letter is kept", () => {
  assert.equal(stripCorrectLetterPrefix("B) Meiosis"), "Meiosis");
  assert.equal(stripCorrectLetterPrefix("B"), "B");
  assert.equal(stripCorrectLetterPrefix(" c "), "c");
});
