import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcqAttempt,
  getOrCreateMcqAttempt,
  isCorrectMcqChoice,
  restoreMcqAttempt,
  shuffleOrder,
} from "./quiz-randomization";
import type { CourseQuizMcqItem } from "../types/course";

const duplicateChoiceQuestion: CourseQuizMcqItem = {
  question: "Which repeated label is the stored correct answer?",
  choices: ["same", "other", "same", "last"],
  correct: "same",
  correctIndex: 2,
  explanation: "The second identical label is correct.",
};

const zeroRandom = () => 0;

test("keeps MCQ choice order stable within one attempt", () => {
  const attempts = new Map();
  const first = getOrCreateMcqAttempt(
    attempts,
    "question-1",
    duplicateChoiceQuestion,
    undefined,
    zeroRandom
  );
  const rerender = getOrCreateMcqAttempt(
    attempts,
    "question-1",
    duplicateChoiceQuestion,
    undefined,
    () => 0.99
  );

  assert.strictEqual(rerender, first);
  assert.deepEqual(rerender.sourceOrder, first.sourceOrder);
  assert.deepEqual(
    restoreMcqAttempt(duplicateChoiceQuestion, first.sourceOrder).sourceOrder,
    first.sourceOrder
  );
});

test("avoids the immediately previous order on a fresh attempt", () => {
  const first = createMcqAttempt(
    duplicateChoiceQuestion,
    undefined,
    zeroRandom
  );
  const fresh = createMcqAttempt(
    duplicateChoiceQuestion,
    first.sourceOrder,
    zeroRandom
  );

  assert.notDeepEqual(fresh.sourceOrder, first.sourceOrder);
  assert.deepEqual(
    [...fresh.sourceOrder].sort(),
    [0, 1, 2, 3]
  );
  assert.notDeepEqual(
    shuffleOrder([0, 1, 2], [1, 2, 0], zeroRandom),
    [1, 2, 0]
  );
});

test("preserves correctness by source identity with duplicate text", () => {
  const attempt = createMcqAttempt(
    duplicateChoiceQuestion,
    undefined,
    zeroRandom
  );
  const duplicateChoices = attempt.choices.filter(
    (choice) => choice.text === "same"
  );

  assert.equal(duplicateChoices.length, 2);
  assert.notEqual(duplicateChoices[0].id, duplicateChoices[1].id);
  assert.equal(
    duplicateChoices.filter((choice) =>
      isCorrectMcqChoice(attempt, choice.id)
    ).length,
    1
  );
  assert.equal(
    attempt.choices.find((choice) => choice.isCorrect)?.sourceIndex,
    duplicateChoiceQuestion.correctIndex
  );
});
