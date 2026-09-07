import assert from "node:assert/strict";
import test from "node:test";
import { buildQuizSessionItems } from "./quiz-session";
import type { CourseQuizItem } from "../types/course";

const bank: CourseQuizItem[] = [
  {
    question: "First?",
    choices: ["A", "B", "C", "D"],
    correct: "A",
    correctIndex: 0,
    explanation: "First.",
  },
  {
    question: "Second?",
    choices: ["A", "B", "C", "D"],
    correct: "B",
    correctIndex: 1,
    explanation: "Second.",
  },
];

test("fresh quiz sessions avoid repeating the previous question order", () => {
  const random = () => 0;
  const first = buildQuizSessionItems(bank, [], 1, random);
  const firstOrder = first.map((item) => item.originalIndex);
  const fresh = buildQuizSessionItems(bank, [], 2, random, firstOrder);
  const freshOrder = fresh.map((item) => item.originalIndex);

  assert.notDeepEqual(freshOrder, firstOrder);
  assert.deepEqual([...freshOrder].sort(), [0, 1]);
});
