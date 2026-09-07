import assert from "node:assert/strict";
import test from "node:test";
import {
  disableModuleReviewQuestion,
  isReviewQuestionEnabled,
  parseReviewQuestionTarget,
  replaceModuleReviewQuestion,
  validateReviewQuestion,
} from "./question-mutation";
import type { CoursePayload } from "@/types/course";

const MATERIAL_ID = "123e4567-e89b-42d3-a456-426614174000";
const PERSONAL_ID = "123e4567-e89b-42d3-a456-426614174001";

test("accepts only bounded card targets with valid UUIDs", () => {
  assert.deepEqual(
    parseReviewQuestionTarget({
      kind: "module",
      materialId: MATERIAL_ID,
      questionIndex: 2_003,
    }),
    { kind: "module", materialId: MATERIAL_ID, questionIndex: 2_003 }
  );
  assert.deepEqual(
    parseReviewQuestionTarget({
      kind: "personal",
      personalItemId: PERSONAL_ID,
    }),
    { kind: "personal", personalItemId: PERSONAL_ID }
  );
  assert.equal(
    parseReviewQuestionTarget({
      kind: "personal",
      personalItemId: "not-a-uuid",
    }),
    null
  );
  assert.equal(
    parseReviewQuestionTarget({
      kind: "module",
      materialId: MATERIAL_ID,
      questionIndex: -1,
    }),
    null
  );
});

test("validates and normalizes multiple-choice edits", () => {
  const result = validateReviewQuestion({
    type: "mcq",
    question: "  Which number is even? ",
    choices: [" 1 ", " 2 ", " 3 ", " 5 "],
    correctIndex: 1,
    explanation: " Two divides evenly. ",
  });
  assert.deepEqual(result, {
    ok: true,
    question: {
      type: "mcq",
      question: "Which number is even?",
      choices: ["1", "2", "3", "5"],
      correct: "2",
      correctIndex: 1,
      explanation: "Two divides evenly.",
    },
  });
});

test("rejects invalid answers and duplicate choices", () => {
  assert.equal(
    validateReviewQuestion({
      type: "free_response",
      question: "Explain it",
      referenceAnswer: " ",
      explanation: "",
    }).ok,
    false
  );
  assert.equal(
    validateReviewQuestion({
      type: "mcq",
      question: "Pick one",
      choices: ["Same", "same", "Third", "Fourth"],
      correctIndex: 0,
      explanation: "",
    }).ok,
    false
  );
});

test("edits the addressed module question without moving indexes", () => {
  const payload = fixturePayload();
  const replacement = {
    type: "free_response" as const,
    question: "Replacement",
    referenceAnswer: "Answer",
    explanation: "Why",
  };
  const next = replaceModuleReviewQuestion(payload, 2_001, replacement);
  assert.ok(next);
  assert.equal(next.modules[0].quiz.length, 2);
  assert.deepEqual(next.modules[0].quiz[1], replacement);
  assert.equal(payload.modules[0].quiz[1].question, "Second");
});

test("deletion tombstones only the addressed card and preserves identity", () => {
  const next = disableModuleReviewQuestion(fixturePayload(), 2_000);
  assert.ok(next);
  assert.equal(next.modules[0].quiz.length, 2);
  assert.equal(isReviewQuestionEnabled(next.modules[0].quiz[0]), false);
  assert.equal(isReviewQuestionEnabled(next.modules[0].quiz[1]), true);
});

function fixturePayload(): CoursePayload {
  return {
    title: "Course",
    description: "Description",
    modules: [
      {
        id: 2,
        title: "Module",
        lessons: [],
        quiz: [
          {
            type: "free_response",
            question: "First",
            referenceAnswer: "One",
            explanation: "",
          },
          {
            type: "free_response",
            question: "Second",
            referenceAnswer: "Two",
            explanation: "",
          },
        ],
      },
    ],
  };
}
