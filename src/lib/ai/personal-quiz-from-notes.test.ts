import assert from "node:assert/strict";
import test from "node:test";
import {
  countPersonalQuizTypes,
  parsePersonalQuizModelText,
  planPersonalQuizTypes,
  selectPersonalQuizItems,
} from "./personal-quiz-from-notes";
import { isQuizFreeResponse, isQuizMcq } from "@/types/course";

const SAMPLE = {
  type: "mcq",
  question: "What binds oxygen in blood?",
  choices: ["Hemoglobin", "Insulin", "Keratin", "Pepsin"],
  correct: "A",
  explanation: "Hemoglobin in red cells binds O2.",
};

const FRQ_SAMPLE = {
  type: "free_response",
  question: "Explain how hemoglobin supports oxygen transport.",
  reference_answer:
    "Hemoglobin binds oxygen in red blood cells and carries it through the bloodstream to tissues.",
  explanation: "A strong answer connects binding in red cells to transport.",
};

test("parsePersonalQuizModelText reads a clean array", () => {
  const parsed = parsePersonalQuizModelText(JSON.stringify([SAMPLE]));
  assert.equal(parsed.length, 1);
  assert.equal((parsed[0] as { question: string }).question, SAMPLE.question);
});

test("parsePersonalQuizModelText unwraps a questions object and fences", () => {
  const raw = `Here you go:\n\`\`\`json\n{"questions":[${JSON.stringify(SAMPLE)}]}\n\`\`\``;
  const parsed = parsePersonalQuizModelText(raw);
  assert.equal(parsed.length, 1);
});

test("parsePersonalQuizModelText salvages a truncated array", () => {
  const raw = `[${JSON.stringify(SAMPLE)},${JSON.stringify({
    ...SAMPLE,
    question: "What is the powerhouse of the cell?",
  })},{ "type": "mcq", "question": "Truncated`;
  const parsed = parsePersonalQuizModelText(raw);
  assert.equal(parsed.length, 2);
});

test("parsePersonalQuizModelText tolerates trailing commas and smart quotes", () => {
  const raw = `[{ “type”: “mcq”, “question”: “What binds oxygen in blood?”, “choices”: [“Hemoglobin”, “Insulin”, “Keratin”, “Pepsin”,], “correct”: “A”, “explanation”: “Hemoglobin binds O2.”, }]`;
  const parsed = parsePersonalQuizModelText(raw);
  assert.equal(parsed.length, 1);
});

test("planPersonalQuizTypes balances an empty set with FRQ-first tie behavior", () => {
  assert.deepEqual(planPersonalQuizTypes(3), [
    "free_response",
    "mcq",
    "free_response",
  ]);
  assert.deepEqual(planPersonalQuizTypes(4), [
    "free_response",
    "mcq",
    "free_response",
    "mcq",
  ]);
});

test("planPersonalQuizTypes uses odd slot to correct existing imbalance", () => {
  assert.deepEqual(
    planPersonalQuizTypes(3, { mcq: 7, freeResponse: 2 }),
    ["free_response", "mcq", "free_response"]
  );
  assert.deepEqual(
    planPersonalQuizTypes(3, { mcq: 2, freeResponse: 7 }),
    ["mcq", "free_response", "mcq"]
  );
});

test("successive odd batches alternate the extra type", () => {
  const first = planPersonalQuizTypes(3);
  const afterFirst = {
    mcq: first.filter((type) => type === "mcq").length,
    freeResponse: first.filter((type) => type === "free_response").length,
  };
  const second = planPersonalQuizTypes(3, afterFirst);
  const combined = [...first, ...second];
  assert.equal(combined.filter((type) => type === "mcq").length, 3);
  assert.equal(
    combined.filter((type) => type === "free_response").length,
    3
  );
});

test("malformed FRQ stays missing until a valid FRQ fallback is available", () => {
  const plan = ["free_response", "mcq"] as const;
  const malformedFrq = {
    type: "free_response",
    question: "Explain oxygen transport.",
    explanation: "Hemoglobin is involved.",
  };
  const extraMcq = {
    ...SAMPLE,
    question: "Which molecule carries oxygen?",
  };

  const beforeRepair = selectPersonalQuizItems(
    [malformedFrq, SAMPLE, extraMcq],
    [...plan]
  );
  assert.equal(beforeRepair.length, 1);
  assert.ok(isQuizMcq(beforeRepair[0]!));

  const afterRepair = selectPersonalQuizItems(
    [malformedFrq, SAMPLE, extraMcq, FRQ_SAMPLE],
    [...plan]
  );
  assert.equal(afterRepair.length, 2);
  assert.ok(isQuizFreeResponse(afterRepair[0]!));
  assert.ok(isQuizMcq(afterRepair[1]!));
});

test("selected cards retain persistence-ready MCQ and FRQ shapes", () => {
  const selected = selectPersonalQuizItems(
    [FRQ_SAMPLE, SAMPLE],
    ["free_response", "mcq"]
  );
  assert.equal(selected.length, 2);
  assert.ok(isQuizFreeResponse(selected[0]!));
  assert.equal(selected[0].referenceAnswer, FRQ_SAMPLE.reference_answer);
  assert.ok(isQuizMcq(selected[1]!));
  assert.equal(selected[1].choices.length, 4);
  assert.equal(selected[1].correctIndex, 0);
  assert.deepEqual(
    countPersonalQuizTypes(selected.map((item) => ({ item }))),
    { mcq: 1, freeResponse: 1 }
  );
});
