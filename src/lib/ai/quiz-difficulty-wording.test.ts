import assert from "node:assert/strict";
import test from "node:test";
import { quizDifficultyWordingRules } from "./quiz-difficulty-wording";

test("quizDifficultyWordingRules conditions wording on difficulty", () => {
  const rules = quizDifficultyWordingRules();
  assert.match(rules, /DIFFICULTY THEN WORDING/i);
  assert.match(rules, /easy/);
  assert.match(rules, /medium/);
  assert.match(rules, /hard/);
  assert.match(rules, /ANTI-PATTERNS/i);
  assert.match(rules, /which of the following/i);
  assert.doesNotMatch(rules, /ELABORATE STEMS/i);
  assert.match(rules, /universal ornate/i);
});
