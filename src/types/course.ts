export type KeyTerm = {
  term: string;
  definition: string;
};

export type CourseLesson = {
  title: string;
  content: string;
  key_terms: KeyTerm[];
  examples: string[];
};

/** Parsed MCQ with resolved correct choice index */
export type CourseQuizMcqItem = {
  type?: "mcq";
  question: string;
  choices: [string, string, string, string];
  /** Original label from model ("A" or matching choice text) */
  correct: string;
  correctIndex: number;
  explanation: string;
};

/** Short-answer item graded by the tutor AI against a reference rubric */
export type CourseQuizFreeItem = {
  type: "free_response";
  question: string;
  /** What a solid answer should capture (used for grading, not shown before submit) */
  referenceAnswer: string;
  explanation: string;
};

export type CourseQuizItem = CourseQuizMcqItem | CourseQuizFreeItem;

/** Written response items (graded against referenceAnswer). */
export function isQuizFreeResponse(q: CourseQuizItem): q is CourseQuizFreeItem {
  return (q as CourseQuizFreeItem).type === "free_response";
}

export function isQuizMcq(q: CourseQuizItem): q is CourseQuizMcqItem {
  return !isQuizFreeResponse(q);
}

export type CourseModule = {
  id: number;
  title: string;
  lessons: CourseLesson[];
  quiz: CourseQuizItem[];
};

export type CoursePayload = {
  title: string;
  description: string;
  modules: CourseModule[];
};

/** Lightweight rows for study sidebar (every PDF / study material in the course). */
export type SidebarMaterialOutline = {
  materialId: string;
  fileName: string;
  modules: { id: number; title: string }[];
  completedModuleIds: number[];
};
