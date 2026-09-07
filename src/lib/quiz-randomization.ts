import type { CourseQuizMcqItem } from "@/types/course";

export type RandomSource = () => number;

export type McqDisplayChoice = {
  /** Stable identity within the stored question, even when labels are duplicated. */
  id: string;
  sourceIndex: number;
  text: string;
  isCorrect: boolean;
};

export type McqAttempt = {
  choices: McqDisplayChoice[];
  sourceOrder: number[];
  correctChoiceId: string;
};

function randomIndex(random: RandomSource, upperExclusive: number): number {
  const value = random();
  const normalized = Number.isFinite(value)
    ? Math.min(0.9999999999999999, Math.max(0, value))
    : 0;
  return Math.floor(normalized * upperExclusive);
}

/** Unbiased Fisher–Yates when `random` is uniform on [0, 1). */
export function fisherYates<T>(
  values: readonly T[],
  random: RandomSource = Math.random
): T[] {
  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomIndex(random, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Shuffle unique identities and avoid the immediately previous permutation
 * when at least two positions exist. The fallback swap only runs when the
 * unbiased draw happens to repeat the previous order.
 */
export function shuffleOrder(
  sourceOrder: readonly number[],
  previousOrder?: readonly number[],
  random: RandomSource = Math.random
): number[] {
  const shuffled = fisherYates(sourceOrder, random);
  if (
    shuffled.length > 1 &&
    previousOrder &&
    sameOrder(shuffled, previousOrder)
  ) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }
  return shuffled;
}

export function createMcqAttempt(
  question: CourseQuizMcqItem,
  previousOrder?: readonly number[],
  random: RandomSource = Math.random
): McqAttempt {
  const sourceOrder = shuffleOrder(
    question.choices.map((_, index) => index),
    previousOrder,
    random
  );
  return mcqAttemptFromOrder(question, sourceOrder);
}

export function restoreMcqAttempt(
  question: CourseQuizMcqItem,
  savedOrder: readonly number[]
): McqAttempt {
  const expected = question.choices.map((_, index) => index);
  const valid =
    savedOrder.length === expected.length &&
    expected.every((index) => savedOrder.includes(index));
  return mcqAttemptFromOrder(question, valid ? savedOrder : expected);
}

function mcqAttemptFromOrder(
  question: CourseQuizMcqItem,
  sourceOrder: readonly number[]
): McqAttempt {
  const choices = sourceOrder.map((sourceIndex) => ({
    id: `choice-${sourceIndex}`,
    sourceIndex,
    text: question.choices[sourceIndex],
    isCorrect: sourceIndex === question.correctIndex,
  }));
  return {
    choices,
    sourceOrder: [...sourceOrder],
    correctChoiceId: `choice-${question.correctIndex}`,
  };
}

/**
 * A component can retain this map for an attempt: repeated renders return the
 * exact same choice order, while a new attempt uses a new map.
 */
export function getOrCreateMcqAttempt(
  attempts: Map<string, McqAttempt>,
  questionKey: string,
  question: CourseQuizMcqItem,
  previousOrder?: readonly number[],
  random: RandomSource = Math.random
): McqAttempt {
  const existing = attempts.get(questionKey);
  if (existing) return existing;
  const created = createMcqAttempt(question, previousOrder, random);
  attempts.set(questionKey, created);
  return created;
}

export function isCorrectMcqChoice(
  attempt: McqAttempt,
  choiceId: string
): boolean {
  return choiceId === attempt.correctChoiceId;
}
