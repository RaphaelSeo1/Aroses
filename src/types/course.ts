export type KeyTerm = {
  term: string;
  definition: string;
};

/** Citation back to an uploaded file (slide/page/section when available). */
export type SourceRef = {
  fileName: string;
  /** e.g. "slides 12–17", "page ~3", "section 2", "document" */
  locator: string;
};

export type CourseLesson = {
  title: string;
  content: string;
  key_terms: KeyTerm[];
  examples: string[];
  /** Present when ingest mapped this lesson to specific upload chunks. */
  sources?: SourceRef[];
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
  /** The exam-group (section) this material belongs to — used to render section headers in the sidebar. */
  examGroupId?: string;
  examGroupName?: string;
};
