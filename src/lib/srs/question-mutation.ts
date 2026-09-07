import type { CoursePayload, CourseQuizItem } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_QUESTION_LENGTH = 2_000;
const MAX_ANSWER_LENGTH = 2_000;
const MAX_EXPLANATION_LENGTH = 5_000;

export type ReviewQuestionTarget =
  | {
      kind: "module";
      materialId: string;
      questionIndex: number;
    }
  | {
      kind: "personal";
      personalItemId: string;
    };

export type ValidationResult =
  | { ok: true; question: CourseQuizItem }
  | { ok: false; error: string };

export function parseReviewQuestionTarget(
  value: unknown
): ReviewQuestionTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;

  if (
    target.kind === "personal" &&
    typeof target.personalItemId === "string" &&
    UUID_RE.test(target.personalItemId)
  ) {
    return { kind: "personal", personalItemId: target.personalItemId };
  }

  if (
    target.kind === "module" &&
    typeof target.materialId === "string" &&
    UUID_RE.test(target.materialId) &&
    typeof target.questionIndex === "number" &&
    Number.isInteger(target.questionIndex) &&
    target.questionIndex >= 0 &&
    target.questionIndex < 1_000_000
  ) {
    return {
      kind: "module",
      materialId: target.materialId,
      questionIndex: target.questionIndex,
    };
  }

  return null;
}

export function validateReviewQuestion(value: unknown): ValidationResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Question data is required." };
  }

  const input = value as Record<string, unknown>;
  const question = cleanText(input.question);
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `Question must be 1–${MAX_QUESTION_LENGTH} characters.`,
    };
  }

  const explanation = cleanText(input.explanation);
  if (explanation.length > MAX_EXPLANATION_LENGTH) {
    return {
      ok: false,
      error: `Explanation must be at most ${MAX_EXPLANATION_LENGTH} characters.`,
    };
  }

  if (input.type === "free_response") {
    const referenceAnswer = cleanText(input.referenceAnswer);
    if (!referenceAnswer || referenceAnswer.length > MAX_ANSWER_LENGTH) {
      return {
        ok: false,
        error: `Answer must be 1–${MAX_ANSWER_LENGTH} characters.`,
      };
    }
    return {
      ok: true,
      question: {
        type: "free_response",
        question,
        referenceAnswer,
        explanation,
      },
    };
  }

  if (!Array.isArray(input.choices) || input.choices.length !== 4) {
    return { ok: false, error: "Multiple-choice questions need 4 choices." };
  }
  const choices = input.choices.map(cleanText);
  if (choices.some((choice) => !choice || choice.length > MAX_ANSWER_LENGTH)) {
    return {
      ok: false,
      error: `Each choice must be 1–${MAX_ANSWER_LENGTH} characters.`,
    };
  }
  if (new Set(choices.map((choice) => choice.toLowerCase())).size !== 4) {
    return { ok: false, error: "Choices must be different." };
  }
  const correctIndex = input.correctIndex;
  if (
    typeof correctIndex !== "number" ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex > 3
  ) {
    return { ok: false, error: "Choose the correct answer." };
  }

  return {
    ok: true,
    question: {
      type: "mcq",
      question,
      choices: choices as [string, string, string, string],
      correct: choices[correctIndex],
      correctIndex,
      explanation,
    },
  };
}

export function replaceModuleReviewQuestion(
  payload: CoursePayload,
  questionIndex: number,
  question: CourseQuizItem
): CoursePayload | null {
  const location = locateModuleQuestion(payload, questionIndex);
  if (!location) return null;
  const next = structuredClone(payload);
  next.modules[location.moduleIndex].quiz[location.quizIndex] = question;
  return next;
}

/**
 * Module-card indices are persisted in attempts and SRS rows. Removing an
 * array entry would silently point every later row at the wrong question, so
 * deletion uses an in-place tombstone that excludes the card from review.
 */
export function disableModuleReviewQuestion(
  payload: CoursePayload,
  questionIndex: number
): CoursePayload | null {
  const location = locateModuleQuestion(payload, questionIndex);
  if (!location) return null;
  const next = structuredClone(payload);
  next.modules[location.moduleIndex].quiz[location.quizIndex] = {
    ...next.modules[location.moduleIndex].quiz[location.quizIndex],
    reviewDisabled: true,
  };
  return next;
}

export function isReviewQuestionEnabled(
  question: CourseQuizItem | null | undefined
): question is CourseQuizItem {
  return Boolean(question && !question.reviewDisabled);
}

function locateModuleQuestion(
  payload: CoursePayload,
  questionIndex: number
): { moduleIndex: number; quizIndex: number } | null {
  const moduleId = Math.floor(questionIndex / 1_000);
  const quizIndex = questionIndex % 1_000;
  const moduleIndex = payload.modules.findIndex((module) => module.id === moduleId);
  if (moduleIndex < 0 || !payload.modules[moduleIndex].quiz[quizIndex]) return null;
  return { moduleIndex, quizIndex };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
