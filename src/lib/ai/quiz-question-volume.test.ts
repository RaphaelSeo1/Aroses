import assert from "node:assert/strict";
import test from "node:test";
import {
  QUIZ_QUESTION_VOLUME_MAX,
  QUIZ_QUESTION_VOLUME_MIN,
  clampQuizQuestionSoftMax,
  quizQuestionVolumeRules,
} from "./quiz-question-volume.ts";

test("clampQuizQuestionSoftMax stays within 1–6", () => {
  assert.equal(clampQuizQuestionSoftMax(1), 1);
  assert.equal(clampQuizQuestionSoftMax(6), 6);
  assert.equal(clampQuizQuestionSoftMax(0), QUIZ_QUESTION_VOLUME_MIN);
  assert.equal(clampQuizQuestionSoftMax(99), QUIZ_QUESTION_VOLUME_MAX);
  assert.equal(clampQuizQuestionSoftMax(Number.NaN), QUIZ_QUESTION_VOLUME_MAX);
});

test("quizQuestionVolumeRules encodes teachable-unit criteria", () => {
  const rules = quizQuestionVolumeRules(6);
  assert.match(rules, /QUESTION VOLUME/i);
  assert.match(rules, /distinct teachable units/i);
  assert.match(rules, /One term\/definition/);
  assert.match(rules, /1–2/);
  assert.match(rules, /2–4/);
  assert.match(rules, /4–6/);
  assert.match(rules, /Do NOT pad/i);
  assert.match(rules, /near-duplicate/i);
  assert.match(rules, /under-cover/i);
  assert.match(rules, /List of N independent items/);
});
