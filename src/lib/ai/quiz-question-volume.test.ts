import assert from "node:assert/strict";
import test from "node:test";
import { quizQuestionVolumeRules } from "./quiz-question-volume.ts";

test("quizQuestionVolumeRules encodes importance-driven volume without fixed buckets", () => {
  const rules = quizQuestionVolumeRules();
  assert.match(rules, /QUESTION VOLUME/i);
  assert.match(rules, /important to understand/i);
  assert.match(rules, /one question per important idea/i);
  assert.match(rules, /no fixed target/i);
  assert.match(rules, /no artificial maximum/i);
  assert.match(rules, /8–10 or more/i);
  assert.match(rules, /Do NOT pad/i);
  assert.match(rules, /near-duplicate/i);
  assert.match(rules, /under-cover/i);
  assert.doesNotMatch(rules, /between 1 and 6/i);
  assert.doesNotMatch(rules, /1–2/);
  assert.doesNotMatch(rules, /2–4/);
  assert.doesNotMatch(rules, /4–6/);
});
