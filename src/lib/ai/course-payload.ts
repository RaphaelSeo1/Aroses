import type {
  CourseLesson,
  CourseModule,
  CoursePayload,
  CourseQuizFreeItem,
  CourseQuizItem,
  CourseQuizMcqItem,
  KeyTerm,
} from "@/types/course";

export function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return s.trim();
}

function resolveCorrectIndex(
  correct: string,
  choices: [string, string, string, string]
): number {
  const t = correct.trim();
  if (/^[ABCD]$/i.test(t)) {
    return t.toUpperCase().charCodeAt(0) - 65;
  }
  const exact = choices.findIndex((c) => c.trim() === t);
  if (exact >= 0) return exact;
  const loose = choices.findIndex(
    (c) => c.trim().toLowerCase() === t.toLowerCase()
  );
  if (loose >= 0) return loose;
  throw new Error("Could not resolve correct answer for a quiz question");
}

type RawQuiz = {
  question?: unknown;
  choices?: unknown;
  correct?: unknown;
  explanation?: unknown;
};

function normalizeQuizMcq(raw: RawQuiz): CourseQuizMcqItem {
  if (
    typeof raw.question !== "string" ||
    !Array.isArray(raw.choices) ||
    raw.choices.length !== 4 ||
    typeof raw.correct !== "string" ||
    typeof raw.explanation !== "string"
  ) {
    throw new Error("Invalid quiz item shape");
  }
  const choices = raw.choices.map((c) =>
    typeof c === "string" ? c : String(c)
  ) as [string, string, string, string];
  const correctIndex = resolveCorrectIndex(raw.correct, choices);
  return {
    type: "mcq",
    question: raw.question,
    choices,
    correct: raw.correct.trim(),
    correctIndex,
    explanation: raw.explanation,
  };
}

function normalizeQuizFree(raw: Record<string, unknown>): CourseQuizFreeItem {
  const question =
    typeof raw.question === "string" ? raw.question.trim() : "";
  const referenceAnswer =
    typeof raw.reference_answer === "string"
      ? raw.reference_answer.trim()
      : typeof raw.referenceAnswer === "string"
        ? raw.referenceAnswer.trim()
        : "";
  let explanation =
    typeof raw.explanation === "string" ? raw.explanation.trim() : "";
  if (explanation.length < 2) {
    explanation = "Review the module lessons for related ideas.";
  }

  if (question.length < 4) throw new Error("Invalid free-response question");
  if (referenceAnswer.length < 6) {
    throw new Error("Free-response items need a substantive reference_answer");
  }

  return {
    type: "free_response",
    question,
    referenceAnswer,
    explanation,
  };
}

const FREE_RESPONSE_TYPES = new Set([
  "free_response",
  "short_answer",
  "written",
  "essay",
  "open_ended",
  "long_answer",
  "frq",
  "open",
]);

function normalizeQuizItem(raw: unknown): CourseQuizItem {
  if (!raw || typeof raw !== "object") throw new Error("Invalid quiz item");
  const o = raw as Record<string, unknown>;

  const rawType =
    typeof o.type === "string" ? o.type.trim().toLowerCase() : "";
  if (FREE_RESPONSE_TYPES.has(rawType)) {
    return normalizeQuizFree(o);
  }

  const hasChoices =
    Array.isArray(o.choices) && (o.choices as unknown[]).length > 0;
  const ref =
    typeof o.reference_answer === "string"
      ? o.reference_answer.trim()
      : typeof o.referenceAnswer === "string"
        ? (o.referenceAnswer as string).trim()
        : "";

  const hasCorrectStr =
    typeof o.correct === "string" && o.correct.trim().length > 0;

  /** Models sometimes attach reference_answer to an MCQ-shaped object without `correct`. */
  if (hasChoices && !hasCorrectStr && ref.length >= 6) {
    return normalizeQuizFree(o);
  }

  if (!hasChoices && ref.length >= 6) {
    return normalizeQuizFree(o);
  }

  return normalizeQuizMcq(raw as RawQuiz);
}

/**
 * Best-effort: keep every quiz item that passes validation (drops malformed rows).
 * Used when ingesting model JSON that may include a few bad entries.
 */
export function normalizeQuizItemsLoose(raw: unknown[]): CourseQuizItem[] {
  const out: CourseQuizItem[] = [];
  for (const q of raw) {
    try {
      out.push(normalizeQuizItem(q));
    } catch {
      /* skip */
    }
  }
  return out;
}

function looksLikeQuizItem(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.question !== "string") return false;
  const ty = typeof o.type === "string" ? o.type.trim().toLowerCase() : "";
  if (FREE_RESPONSE_TYPES.has(ty)) return true;
  const choices = o.choices;
  if (Array.isArray(choices) && choices.length >= 2) return true;
  if (
    typeof o.reference_answer === "string" &&
    o.reference_answer.trim().length >= 6
  ) {
    return true;
  }
  if (
    typeof o.referenceAnswer === "string" &&
    o.referenceAnswer.trim().length >= 6
  ) {
    return true;
  }
  return false;
}

/** Models sometimes emit `questions` or `practice_questions` instead of `quiz`. */
function coerceModuleQuizArray(o: Record<string, unknown>): unknown[] {
  const keys = [
    "quiz",
    "practice_quiz",
    "practice_questions",
    "questions",
  ] as const;
  let fallback: unknown[] | null = null;
  for (const k of keys) {
    const c = o[k];
    if (!Array.isArray(c) || c.length === 0) continue;
    if (looksLikeQuizItem(c[0])) return c;
    if (!fallback && normalizeQuizItemsLoose(c).length > 0) {
      fallback = c;
    }
  }
  return fallback ?? [];
}

function readLooseStringField(
  rec: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const kk of Object.keys(rec)) {
    const low = kk.toLowerCase();
    for (const k of keys) {
      if (low === k.toLowerCase()) {
        const v = rec[kk];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  return undefined;
}

/** Accepts `key_terms`, camelCase `keyTerms`, alternate keys, or `"term: def"` strings. */
function normalizeKeyTerms(raw: unknown): KeyTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyTerm[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const s = x.trim();
      const idx = s.indexOf(":");
      if (idx > 0 && idx < s.length - 1) {
        const term = s.slice(0, idx).trim();
        const definition = s.slice(idx + 1).trim();
        if (term.length >= 2 && definition.length >= 4) {
          out.push({ term, definition });
        }
      }
      continue;
    }
    if (!x || typeof x !== "object") continue;
    const rec = x as Record<string, unknown>;
    const term =
      readLooseStringField(rec, [
        "term",
        "Term",
        "name",
        "keyword",
        "title",
        "concept",
      ]) ?? "";
    const definition =
      readLooseStringField(rec, [
        "definition",
        "Definition",
        "meaning",
        "explanation",
        "description",
        "def",
      ]) ?? "";
    if (term.length >= 2 && definition.length >= 4) {
      out.push({ term, definition });
    }
  }
  return out;
}

function normalizeLesson(raw: unknown): CourseLesson {
  if (!raw || typeof raw !== "object") throw new Error("Invalid lesson");
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== "string" || typeof o.content !== "string") {
    throw new Error("Invalid lesson title/content");
  }
  const examplesRaw =
    o.examples ?? o.real_world_examples ?? o.realWorldExamples ?? o.RealWorldExamples;
  const examples = Array.isArray(examplesRaw)
    ? examplesRaw
        .map((e) => {
          if (typeof e === "string") return e.trim();
          if (e && typeof e === "object" && typeof (e as { text: unknown }).text === "string") {
            return String((e as { text: string }).text).trim();
          }
          return "";
        })
        .filter((s) => s.length > 0)
    : [];
  const keyTermsRaw = o.key_terms ?? o.keyTerms ?? o.KeyTerms ?? o["Key terms"];
  return {
    title: o.title,
    content: o.content,
    key_terms: normalizeKeyTerms(keyTermsRaw),
    examples,
  };
}

function normalizeModule(raw: unknown): CourseModule {
  if (!raw || typeof raw !== "object") throw new Error("Invalid module");
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "number" ? o.id : Number(o.id);
  if (!Number.isFinite(id)) throw new Error("Invalid module id");
  if (typeof o.title !== "string") throw new Error("Invalid module title");

  const lessonsRaw = o.lessons;
  if (!Array.isArray(lessonsRaw) || lessonsRaw.length === 0) {
    throw new Error("Each module needs at least one lesson");
  }
  const lessons = lessonsRaw.map(normalizeLesson);

  const quizRaw = coerceModuleQuizArray(o);
  const quiz = normalizeQuizItemsLoose(quizRaw);
  if (quiz.length === 0) {
    throw new Error("Each module needs at least one valid quiz question");
  }

  return { id, title: o.title, lessons, quiz };
}

/** Assign module ids 1…n in array order (after delete/reorder). */
export function renumberModules(modules: CourseModule[]): CourseModule[] {
  return modules.map((m, i) => ({ ...m, id: i + 1 }));
}

/** One module from model JSON (used by chunked PDF ingest). */
export function parseCourseModule(raw: unknown): CourseModule {
  return normalizeModule(raw);
}

export type CourseOutlineStub = {
  id: number;
  title: string;
  lesson_titles: string[];
};

export type CourseOutlinePayload = {
  title: string;
  description: string;
  modules: CourseOutlineStub[];
};

function normalizeOutlineStub(raw: unknown): CourseOutlineStub {
  if (!raw || typeof raw !== "object") throw new Error("Invalid outline module");
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "number" ? o.id : Number(o.id);
  if (!Number.isFinite(id)) throw new Error("Invalid outline module id");
  if (typeof o.title !== "string" || !o.title.trim()) {
    throw new Error("Invalid outline module title");
  }
  const lt = o.lesson_titles ?? o.lessonTitles;
  if (!Array.isArray(lt) || lt.length === 0) {
    throw new Error("Outline module needs at least one lesson_titles entry");
  }
  const lesson_titles = lt
    .map((x) => (typeof x === "string" ? x.trim() : String(x)))
    .filter((s) => s.length > 0);
  if (lesson_titles.length === 0) {
    throw new Error("Outline lesson_titles must be non-empty strings");
  }
  return { id, title: o.title.trim(), lesson_titles };
}

/** Validate outline JSON for phase 1 of chunked ingest. */
export function parseCourseOutlinePayload(parsed: unknown): CourseOutlinePayload {
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== "string" || !obj.title.trim()) {
    throw new Error("Invalid outline: missing title");
  }
  if (typeof obj.description !== "string" || !obj.description.trim()) {
    throw new Error("Invalid outline: missing description");
  }
  if (!Array.isArray(obj.modules) || obj.modules.length === 0) {
    throw new Error("Invalid outline: need at least one module");
  }
  const modules = obj.modules.map(normalizeOutlineStub);
  return {
    title: obj.title.trim(),
    description: obj.description.trim(),
    modules,
  };
}

/** Validate & normalize parsed JSON into CoursePayload (same rules as generation). */
export function parseCoursePayload(parsed: unknown): CoursePayload {
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== "string" || typeof obj.description !== "string") {
    throw new Error("Invalid course: missing title or description");
  }
  if (!Array.isArray(obj.modules) || obj.modules.length === 0) {
    throw new Error("Invalid course: need at least one module");
  }

  const modules = obj.modules.map(normalizeModule);

  return {
    title: obj.title,
    description: obj.description,
    modules,
  };
}
