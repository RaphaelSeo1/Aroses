import assert from "node:assert/strict";
import test from "node:test";
import { parsePersonalQuizModelText } from "./personal-quiz-from-notes";

const SAMPLE = {
  type: "mcq",
  question: "What binds oxygen in blood?",
  choices: ["Hemoglobin", "Insulin", "Keratin", "Pepsin"],
  correct: "A",
  explanation: "Hemoglobin in red cells binds O2.",
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
