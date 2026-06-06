export type CourseOutputLanguage = "en" | "ko" | "auto";

export const DEFAULT_COURSE_OUTPUT_LANGUAGE: CourseOutputLanguage = "auto";

export const COURSE_OUTPUT_LANGUAGE_OPTIONS: {
  value: CourseOutputLanguage;
  label: string;
  description: string;
}[] = [
  {
    value: "auto",
    label: "Match my files",
    description: "Use the main language in your uploads",
  },
  {
    value: "en",
    label: "English",
    description: "Lessons and quizzes in English",
  },
  {
    value: "ko",
    label: "한국어",
    description: "Lessons and quizzes in Korean",
  },
];

export function parseCourseOutputLanguage(raw: unknown): CourseOutputLanguage {
  if (raw === "en" || raw === "ko" || raw === "auto") return raw;
  return DEFAULT_COURSE_OUTPUT_LANGUAGE;
}

/** Prompt block for course outline / module / quiz generation. */
export function formatOutputLanguageGenerationBlock(
  lang: CourseOutputLanguage
): string {
  if (lang === "en") {
    return `OUTPUT LANGUAGE (required): Write ALL student-facing text in **English** — lesson "content", "key_terms" definitions, "examples", quiz "question" text, MCQ "choices", "explanation", and free-response "reference_answer" rubrics. Keep JSON keys in English; only string values are English.`;
  }
  if (lang === "ko") {
    return `OUTPUT LANGUAGE (required): Write ALL student-facing text in **Korean (한국어)** — lesson "content", "key_terms" definitions, "examples", quiz "question" text, MCQ "choices", "explanation", and free-response "reference_answer" rubrics. Use natural, clear Korean for teaching. JSON keys stay in English; string values are Korean. Technical terms from the source may stay in English when standard in Korean academia.`;
  }
  return `OUTPUT LANGUAGE (required): Detect the **primary language** of the source material. Write ALL student-facing text (lesson content, definitions, examples, quiz questions, choices, explanations, reference answers) in that same language. If the material mixes languages, prefer the language used for the main teaching prose. JSON keys stay in English.`;
}
