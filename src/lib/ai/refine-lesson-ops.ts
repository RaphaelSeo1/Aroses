import type { CourseModule, KeyTerm } from "@/types/course";

/**
 * Surgical lesson edits. Instead of asking the model to return a whole rewritten
 * module (which invites "rewrite everything" behaviour), the model returns a
 * small list of ops. We apply them in code so every byte of untouched text /
 * every untouched key_term / example is preserved exactly.
 */

export type LessonEditOp = {
  lessonIndex: number;
  /** Verbatim substring to locate for a replace/delete in lesson content. */
  find?: string;
  /** Replacement text; empty string (or omitted with `find`) means delete. */
  replace?: string;
  /** Anchor-free content insertion. */
  insert?: "start" | "end";
  /** Text to insert when `insert` is set. */
  text?: string;
  /** Structured: add a key term card. */
  addKeyTerm?: { term: string; definition: string };
  /** Structured: remove a key term by matching its term (case-insensitive). */
  removeKeyTerm?: string;
  /** Structured: replace a key term's definition (match by term). */
  replaceKeyTerm?: { term: string; definition: string };
  /** Structured: add an example bullet. */
  addExample?: string;
  /** Structured: remove an example by matching substring (case-insensitive). */
  removeExample?: string;
};

/** A concrete content change, with offsets at application time. */
export type LessonEditChange = {
  lessonIndex: number;
  /** Offset in the (evolving) lesson content where the change begins. */
  start: number;
  /** Number of characters removed at `start`. */
  deleteLen: number;
  /** Text inserted at `start` (after the deletion). */
  insert: string;
};

/**
 * Where an op lands for the pre-confirm preview (content caret OR structured
 * key-term / example markers).
 */
export type LessonEditPreview = {
  lessonIndex: number;
  kind: "content" | "key_term" | "example";
  /** Content-span fields (kind === "content"). */
  start?: number;
  deleteLen?: number;
  insert?: string;
  /** Structured preview labels. */
  term?: string;
  definition?: string;
  example?: string;
  action?: "add" | "remove" | "replace";
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find `needle` inside `haystack`. Tries an exact match first, then a
 * whitespace-tolerant match (so minor whitespace differences in the model's
 * quoted snippet still resolve). Returns the match offset + matched length.
 */
export function locateSpan(
  haystack: string,
  needle: string
): { index: number; length: number } | null {
  if (!needle) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { index: exact, length: needle.length };

  const tokens = needle.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (tokens.length === 0) return null;
  try {
    const re = new RegExp(tokens.join("\\s+"));
    const m = re.exec(haystack);
    if (m) return { index: m.index, length: m[0].length };
  } catch {
    /* bad regex — treat as no match */
  }
  return null;
}

function isActionableOp(op: LessonEditOp): boolean {
  return Boolean(
    op.find ||
      (op.insert && op.text) ||
      op.addKeyTerm ||
      op.removeKeyTerm ||
      op.replaceKeyTerm ||
      op.addExample ||
      op.removeExample
  );
}

/**
 * Apply edit ops to a module's lessons, in order. Returns the new module plus
 * the sequence of concrete *content* changes (for caret animation). Structured
 * key_term / example ops still mutate the module but do not emit content
 * changes (the client updates those sections via module_patch).
 */
export function applyLessonEditOps(
  module: CourseModule,
  ops: LessonEditOp[]
): {
  module: CourseModule;
  changes: LessonEditChange[];
  structuredTouched: number;
} {
  const lessons = module.lessons.map((l) => ({
    ...l,
    key_terms: l.key_terms.map((k) => ({ ...k })),
    examples: [...l.examples],
  }));
  const changes: LessonEditChange[] = [];
  let structuredTouched = 0;

  for (const op of ops) {
    const li = op.lessonIndex;
    if (!Number.isInteger(li) || li < 0 || li >= lessons.length) continue;
    const lesson = lessons[li];
    const content = lesson.content ?? "";

    // --- Structured: key terms ---
    if (op.addKeyTerm?.term?.trim()) {
      const term = op.addKeyTerm.term.trim();
      const definition = (op.addKeyTerm.definition ?? "").trim();
      const exists = lesson.key_terms.some(
        (k) => k.term.trim().toLowerCase() === term.toLowerCase()
      );
      if (!exists) {
        lesson.key_terms.push({ term, definition });
        structuredTouched += 1;
      }
      continue;
    }
    if (typeof op.removeKeyTerm === "string" && op.removeKeyTerm.trim()) {
      const needle = op.removeKeyTerm.trim().toLowerCase();
      const before = lesson.key_terms.length;
      lesson.key_terms = lesson.key_terms.filter(
        (k) => k.term.trim().toLowerCase() !== needle
      );
      if (lesson.key_terms.length !== before) structuredTouched += 1;
      continue;
    }
    if (op.replaceKeyTerm?.term?.trim()) {
      const needle = op.replaceKeyTerm.term.trim().toLowerCase();
      const definition = (op.replaceKeyTerm.definition ?? "").trim();
      let hit = false;
      lesson.key_terms = lesson.key_terms.map((k) => {
        if (k.term.trim().toLowerCase() !== needle) return k;
        hit = true;
        return { ...k, definition };
      });
      if (hit) structuredTouched += 1;
      continue;
    }

    // --- Structured: examples ---
    if (typeof op.addExample === "string" && op.addExample.trim()) {
      const text = op.addExample.trim();
      if (!lesson.examples.some((e) => e.trim() === text)) {
        lesson.examples.push(text);
        structuredTouched += 1;
      }
      continue;
    }
    if (typeof op.removeExample === "string" && op.removeExample.trim()) {
      const needle = op.removeExample.trim().toLowerCase();
      const before = lesson.examples.length;
      lesson.examples = lesson.examples.filter(
        (e) => !e.toLowerCase().includes(needle)
      );
      if (lesson.examples.length !== before) structuredTouched += 1;
      continue;
    }

    // --- Content: anchor-free insert ---
    if (op.insert === "end" && typeof op.text === "string" && op.text) {
      const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n\n";
      const insert = `${prefix}${op.text}`;
      changes.push({
        lessonIndex: li,
        start: content.length,
        deleteLen: 0,
        insert,
      });
      lesson.content = content + insert;
      continue;
    }
    if (op.insert === "start" && typeof op.text === "string" && op.text) {
      const insert = content.startsWith("\n") ? op.text : `${op.text}\n\n`;
      changes.push({ lessonIndex: li, start: 0, deleteLen: 0, insert });
      lesson.content = insert + content;
      continue;
    }

    // --- Content: find / replace / delete ---
    if (typeof op.find === "string" && op.find.length > 0) {
      const span = locateSpan(content, op.find);
      if (!span) continue; // unmatched op is skipped, not a full rewrite
      const replace = typeof op.replace === "string" ? op.replace : "";
      changes.push({
        lessonIndex: li,
        start: span.index,
        deleteLen: span.length,
        insert: replace,
      });
      lesson.content =
        content.slice(0, span.index) +
        replace +
        content.slice(span.index + span.length);
    }
  }

  return { module: { ...module, lessons }, changes, structuredTouched };
}

/**
 * Locate each op for the pre-confirm preview. Content ops become caret spans;
 * structured ops become key_term / example markers.
 */
export function previewLocations(
  module: CourseModule,
  ops: LessonEditOp[]
): LessonEditPreview[] {
  const out: LessonEditPreview[] = [];
  for (const op of ops) {
    const li = op.lessonIndex;
    const lesson = module.lessons[li];
    if (!lesson) continue;
    const content = lesson.content ?? "";

    if (op.addKeyTerm?.term?.trim()) {
      out.push({
        lessonIndex: li,
        kind: "key_term",
        action: "add",
        term: op.addKeyTerm.term.trim(),
        definition: (op.addKeyTerm.definition ?? "").trim(),
      });
      continue;
    }
    if (typeof op.removeKeyTerm === "string" && op.removeKeyTerm.trim()) {
      out.push({
        lessonIndex: li,
        kind: "key_term",
        action: "remove",
        term: op.removeKeyTerm.trim(),
      });
      continue;
    }
    if (op.replaceKeyTerm?.term?.trim()) {
      out.push({
        lessonIndex: li,
        kind: "key_term",
        action: "replace",
        term: op.replaceKeyTerm.term.trim(),
        definition: (op.replaceKeyTerm.definition ?? "").trim(),
      });
      continue;
    }
    if (typeof op.addExample === "string" && op.addExample.trim()) {
      out.push({
        lessonIndex: li,
        kind: "example",
        action: "add",
        example: op.addExample.trim(),
      });
      continue;
    }
    if (typeof op.removeExample === "string" && op.removeExample.trim()) {
      out.push({
        lessonIndex: li,
        kind: "example",
        action: "remove",
        example: op.removeExample.trim(),
      });
      continue;
    }

    if (op.insert === "end" && typeof op.text === "string" && op.text) {
      out.push({
        lessonIndex: li,
        kind: "content",
        start: content.length,
        deleteLen: 0,
        insert: op.text,
      });
      continue;
    }
    if (op.insert === "start" && typeof op.text === "string" && op.text) {
      out.push({
        lessonIndex: li,
        kind: "content",
        start: 0,
        deleteLen: 0,
        insert: op.text,
      });
      continue;
    }
    if (typeof op.find === "string" && op.find.length > 0) {
      const span = locateSpan(content, op.find);
      if (!span) continue;
      out.push({
        lessonIndex: li,
        kind: "content",
        start: span.index,
        deleteLen: span.length,
        insert: typeof op.replace === "string" ? op.replace : "",
      });
    }
  }
  return out;
}

function coerceKeyTerm(value: unknown): KeyTerm | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.term !== "string" || !o.term.trim()) return null;
  return {
    term: o.term.trim(),
    definition: typeof o.definition === "string" ? o.definition.trim() : "",
  };
}

/** Coerce loose model JSON into a clean op list. */
export function coerceLessonEditOps(value: unknown): LessonEditOp[] {
  const raw = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { ops?: unknown }).ops)
      ? (value as { ops: unknown[] }).ops
      : [];
  const ops: LessonEditOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const lessonIndex =
      typeof o.lessonIndex === "number"
        ? o.lessonIndex
        : Number(o.lessonIndex);
    if (!Number.isInteger(lessonIndex)) continue;
    const op: LessonEditOp = { lessonIndex };
    if (typeof o.find === "string") op.find = o.find;
    if (typeof o.replace === "string") op.replace = o.replace;
    if (o.insert === "start" || o.insert === "end") op.insert = o.insert;
    if (typeof o.text === "string") op.text = o.text;

    const addKt = coerceKeyTerm(o.addKeyTerm ?? o.add_key_term);
    if (addKt) op.addKeyTerm = addKt;
    if (typeof o.removeKeyTerm === "string") op.removeKeyTerm = o.removeKeyTerm;
    else if (typeof o.remove_key_term === "string")
      op.removeKeyTerm = o.remove_key_term;
    const replaceKt = coerceKeyTerm(o.replaceKeyTerm ?? o.replace_key_term);
    if (replaceKt) op.replaceKeyTerm = replaceKt;

    if (typeof o.addExample === "string") op.addExample = o.addExample;
    else if (typeof o.add_example === "string") op.addExample = o.add_example;
    if (typeof o.removeExample === "string") op.removeExample = o.removeExample;
    else if (typeof o.remove_example === "string")
      op.removeExample = o.remove_example;

    if (isActionableOp(op)) ops.push(op);
  }
  return ops;
}
