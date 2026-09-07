import type { CourseQuizItem } from "@/types/course";
import { isQuizFreeResponse } from "@/types/course";
import {
  fisherYates,
  shuffleOrder,
  type RandomSource,
} from "@/lib/quiz-randomization";

/** Max questions per quiz run (missed items are sampled first when present). */
export const QUIZ_SESSION_MAX_QUESTIONS = 14;

function shuffleIndices(
  length: number,
  random: RandomSource = Math.random
): number[] {
  return fisherYates(
    Array.from({ length }, (_, index) => index),
    random
  );
}

export type QuizSessionItem = {
  question: CourseQuizItem;
  /** Index in the module’s original `quiz` array (for logging / stats). */
  originalIndex: number;
  /** When set, attempts are stored on `user_personal_question_attempts`. */
  personalItemId?: string;
  /** Override shared-bank attempt routing (whole-course mixed sessions). */
  attemptMaterialId?: string;
  attemptModuleId?: number;
};

export type CourseWideQuizEntry = {
  materialId: string;
  moduleId: number;
  quizIndex: number;
  question: CourseQuizItem;
};

/** Random subset from every module/material in the course (up to {@link QUIZ_SESSION_MAX_QUESTIONS}). */
export function buildCourseWideQuizSession(
  entries: CourseWideQuizEntry[],
  _sessionNonce: number,
  random: RandomSource = Math.random,
  previousOriginalOrder?: readonly number[]
): QuizSessionItem[] {
  const n = entries.length;
  if (n === 0) return [];

  const maxQ = Math.min(QUIZ_SESSION_MAX_QUESTIONS, n);
  const sampled = shuffleIndices(n, random).slice(0, maxQ);
  const pick = shuffleOrder(
    sampled,
    previousOriginalOrder &&
      sampled.length === previousOriginalOrder.length &&
      sampled.every((index) => previousOriginalOrder.includes(index))
      ? previousOriginalOrder
      : undefined,
    random
  );

  return pick.map((i) => {
    const e = entries[i]!;
    return {
      question: e.question,
      originalIndex: e.quizIndex,
      attemptMaterialId: e.materialId,
      attemptModuleId: e.moduleId,
    };
  });
}

/** If the random draw had no FR items, swap one slot so written prompts can appear when the bank has them. */
function ensureFreeResponseInSession(
  pick: number[],
  bank: CourseQuizItem[],
  missedSet: Set<number>,
  random: RandomSource
): number[] {
  const frIdx = bank
    .map((item, i) => (isQuizFreeResponse(item) ? i : -1))
    .filter((i) => i >= 0);
  if (frIdx.length === 0) return pick;
  if (pick.some((i) => frIdx.includes(i))) return pick;

  const pool = frIdx.filter((i) => !pick.includes(i));
  if (pool.length === 0) return pick;
  const add = pool[Math.floor(random() * pool.length)];

  let swapPos = pick.findIndex((i) => !missedSet.has(i));
  if (swapPos < 0) swapPos = pick.length - 1;
  if (swapPos < 0) return pick;

  const next = [...pick];
  next[swapPos] = add;
  return next;
}

/**
 * Builds one quiz pass: prioritize missed indices, fill with a random subset,
 * shuffle question order. MC answer order is shuffled in the UI per question.
 */
export function buildQuizSessionItems(
  bank: CourseQuizItem[],
  missedOriginalIndices: number[],
  _sessionNonce: number,
  random: RandomSource = Math.random,
  previousOriginalOrder?: readonly number[]
): QuizSessionItem[] {
  const n = bank.length;
  if (n === 0) return [];

  const maxQ = Math.min(QUIZ_SESSION_MAX_QUESTIONS, n);

  const validMissed = [...new Set(missedOriginalIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < n);

  const missedSet = new Set(validMissed);
  const restIndices = Array.from({ length: n }, (_, i) => i).filter(
    (i) => !missedSet.has(i)
  );

  let pick: number[];

  if (validMissed.length === 0) {
    pick = shuffleIndices(n, random).slice(0, maxQ);
  } else {
    const missedOrder = shuffleIndices(validMissed.length, random).map(
      (j) => validMissed[j]
    );
    const takeMissed = missedOrder.slice(0, Math.min(missedOrder.length, maxQ));
    const room = maxQ - takeMissed.length;
    const restShuffled = shuffleIndices(restIndices.length, random).map(
      (j) => restIndices[j]
    );
    const restFill = restShuffled.slice(0, Math.max(0, room));
    pick = [...takeMissed, ...restFill];
  }

  pick = [...new Set(pick)];
  pick = ensureFreeResponseInSession(pick, bank, missedSet, random);

  const order = shuffleOrder(
    pick,
    previousOriginalOrder &&
      pick.length === previousOriginalOrder.length &&
      pick.every((index) => previousOriginalOrder.includes(index))
      ? previousOriginalOrder
      : undefined,
    random
  );

  return order.map((originalIndex) => ({
    question: bank[originalIndex],
    originalIndex,
  }));
}

type PersonalRow = {
  id: string;
  item: CourseQuizItem;
};

/**
 * Builds a personal quiz session: prioritizes `priorityIndices` (due cards,
 * lapses, etc.), fills with other rows, shuffles order within tiers.
 */
export function buildPersonalQuizSessionItems(
  rows: PersonalRow[],
  priorityIndices: number[],
  sessionNonce: number
): QuizSessionItem[] {
  if (rows.length === 0) return [];
  const bank = rows.map((r) => r.item);
  const slots = buildQuizSessionItems(bank, priorityIndices, sessionNonce);
  return slots.map((s) => ({
    ...s,
    personalItemId: rows[s.originalIndex].id,
  }));
}
