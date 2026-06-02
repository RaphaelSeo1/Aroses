import "server-only";
import { stripAllImagesFromMarkdown } from "@/lib/lesson-content-layout";
import {
  analyzeRefineIntent,
  type RefineIntent,
} from "@/lib/ai/refine-course-intent";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CoursePayload } from "@/types/course";

/** Bulk edits applied in code (reliable, instant). */
export type RefineDeterministicOp =
  | { kind: "remove_all_images" }
  | { kind: "remove_all_key_terms" }
  | { kind: "remove_all_examples" };

export type RefinePrepResult = {
  course: CoursePayload;
  intent: RefineIntent;
  applied: string[];
  skipLlm: boolean;
};

function normalizeInstruction(instruction: string): string {
  return instruction.toLowerCase().replace(/\s+/g, " ").trim();
}

function wantsRemove(s: string): boolean {
  return /\b(remove|delete|strip|clear|drop|hide|disable|get rid of|take out|without|no)\b/.test(
    s
  );
}

function wantsBroadScope(s: string): boolean {
  return (
    /\b(all|every|each|entire|whole|any)\b/.test(s) ||
    /\b(every|all) (module|lesson|unit)/.test(s) ||
    /\b(in every|in all|across)\b/.test(s) ||
    /\b(from the|in the|in my) (course|study set|lessons?|modules?)\b/.test(s)
  );
}

export function detectRemoveAllImagesIntent(instruction: string): boolean {
  const s = normalizeInstruction(instruction);
  return (
    wantsRemove(s) &&
    /\b(images?|pictures?|photos?|figures?|diagrams?|illustrations?|visuals?)\b/.test(
      s
    ) &&
    wantsBroadScope(s)
  );
}

export function detectRemoveAllKeyTermsIntent(instruction: string): boolean {
  const s = normalizeInstruction(instruction);
  return (
    wantsRemove(s) &&
    /\b(key terms?|keyterms|vocabulary|definitions?|glossary)\b/.test(s) &&
    wantsBroadScope(s)
  );
}

export function detectRemoveAllExamplesIntent(instruction: string): boolean {
  const s = normalizeInstruction(instruction);
  return (
    wantsRemove(s) &&
    /\b(examples?)\b/.test(s) &&
    wantsBroadScope(s)
  );
}

function instructionNeedsFurtherLlmEdit(instruction: string): boolean {
  const s = normalizeInstruction(instruction);
  return /\b(shorten|rewrite|reword|fix|improve|merge|split|add|rename|retitle|quiz|tone|verbose|tangent|focus|expand|simplify|clarify|module title|lesson title|lesson content|content)\b/.test(
    s
  );
}

export function detectDeterministicRefineOps(
  instruction: string
): RefineDeterministicOp[] {
  const ops: RefineDeterministicOp[] = [];
  if (detectRemoveAllImagesIntent(instruction)) {
    ops.push({ kind: "remove_all_images" });
  }
  if (detectRemoveAllKeyTermsIntent(instruction)) {
    ops.push({ kind: "remove_all_key_terms" });
  }
  if (detectRemoveAllExamplesIntent(instruction)) {
    ops.push({ kind: "remove_all_examples" });
  }
  return ops;
}

function removeAllImagesFromCourse(course: CoursePayload): CoursePayload {
  return {
    ...course,
    modules: course.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => ({
        ...lesson,
        content: stripAllImagesFromMarkdown(lesson.content),
      })),
    })),
  };
}

function removeAllKeyTermsFromCourse(course: CoursePayload): CoursePayload {
  return {
    ...course,
    modules: course.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => ({ ...lesson, key_terms: [] })),
    })),
  };
}

function removeAllExamplesFromCourse(course: CoursePayload): CoursePayload {
  return {
    ...course,
    modules: course.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => ({ ...lesson, examples: [] })),
    })),
  };
}

export async function suppressAllLessonImageCache(
  materialId: string,
  course: CoursePayload
): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;

  const now = new Date().toISOString();
  const rows = [];

  for (const mod of course.modules) {
    for (let lessonIdx = 0; lessonIdx < mod.lessons.length; lessonIdx++) {
      rows.push({
        material_id: materialId,
        module_id: mod.id,
        lesson_idx: lessonIdx,
        needs_image: false,
        search_query: null,
        image_type: null,
        image_url: null,
        image_thumb_url: null,
        source_page_url: null,
        attribution: null,
        updated_at: now,
      });
    }
  }

  if (rows.length === 0) return 0;

  const { error } = await admin.from("lesson_images").upsert(rows, {
    onConflict: "material_id,module_id,lesson_idx",
  });
  if (error) {
    console.error("[refine-course-ops] suppress lesson_images failed", error);
    return 0;
  }
  return rows.length;
}

function countLessonsWithImages(course: CoursePayload): number {
  let n = 0;
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      if (lesson.content !== stripAllImagesFromMarkdown(lesson.content)) n++;
    }
  }
  return n;
}

function countLessonsWithKeyTerms(course: CoursePayload): number {
  let n = 0;
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      if (lesson.key_terms.length > 0) n++;
    }
  }
  return n;
}

function countLessonsWithExamples(course: CoursePayload): number {
  let n = 0;
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      if (lesson.examples.length > 0) n++;
    }
  }
  return n;
}

export async function prepareCourseForRefine(
  materialId: string,
  course: CoursePayload,
  instruction: string
): Promise<RefinePrepResult> {
  const intent = analyzeRefineIntent(course, instruction);
  const ops = detectDeterministicRefineOps(instruction);

  if (ops.length === 0) {
    return { course, intent, applied: [], skipLlm: false };
  }

  let next = course;
  const applied: string[] = [];

  for (const op of ops) {
    if (op.kind === "remove_all_images") {
      const n = countLessonsWithImages(next);
      next = removeAllImagesFromCourse(next);
      const suppressed = await suppressAllLessonImageCache(materialId, next);
      applied.push(
        `Removed embedded images from ${n} lesson${n === 1 ? "" : "s"}.`
      );
      if (suppressed > 0) {
        applied.push(
          `Turned off ${suppressed} cached lesson image${suppressed === 1 ? "" : "s"}.`
        );
      }
    }
    if (op.kind === "remove_all_key_terms") {
      const n = countLessonsWithKeyTerms(next);
      next = removeAllKeyTermsFromCourse(next);
      applied.push(`Cleared key terms from ${n} lesson${n === 1 ? "" : "s"}.`);
    }
    if (op.kind === "remove_all_examples") {
      const n = countLessonsWithExamples(next);
      next = removeAllExamplesFromCourse(next);
      applied.push(`Cleared examples from ${n} lesson${n === 1 ? "" : "s"}.`);
    }
  }

  const onlyDeterministic =
    ops.length > 0 && !instructionNeedsFurtherLlmEdit(instruction);

  return { course: next, intent, applied, skipLlm: onlyDeterministic };
}

export function llmInstructionAfterPrep(
  instruction: string,
  applied: string[]
): string {
  if (applied.length === 0) return instruction;
  return `[Already applied automatically: ${applied.join(" ")}]\n\n${instruction.trim()}`;
}
