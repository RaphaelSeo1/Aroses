import type { CoursePayload } from "@/types/course";
import type { StoredCourseMode } from "@/types/course-progress";

export type ValidatedCoursePosition = {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  scrollPosition: number;
  chunkIndex: number;
  mode: StoredCourseMode;
};

function moduleIds(payload: CoursePayload): number[] {
  return payload.modules
    .map((m) => (typeof m.id === "number" ? m.id : null))
    .filter((id): id is number => id != null);
}

/**
 * Clamp a saved position to the current course outline. Falls back to the
 * first module / lesson when ids are missing or stale.
 */
export function validateCoursePosition(
  payload: CoursePayload,
  materialId: string,
  opts: {
    moduleId?: number | null;
    lessonIndex?: number | null;
    scrollPosition?: number | null;
    chunkIndex?: number | null;
    mode?: StoredCourseMode | null;
  }
): ValidatedCoursePosition {
  const ids = moduleIds(payload);
  const firstModule = ids[0] ?? 1;
  let moduleId =
    typeof opts.moduleId === "number" && ids.includes(opts.moduleId)
      ? opts.moduleId
      : firstModule;

  const mod = payload.modules.find((m) => m.id === moduleId);
  const lessonCount = mod?.lessons?.length ?? 0;
  const maxLesson = Math.max(0, lessonCount - 1);
  let lessonIndex =
    typeof opts.lessonIndex === "number" && Number.isFinite(opts.lessonIndex)
      ? Math.min(Math.max(0, Math.trunc(opts.lessonIndex)), maxLesson)
      : 0;

  if (!mod && payload.modules.length > 0) {
    const fallback = payload.modules[0];
    moduleId = fallback.id;
    lessonIndex = 0;
  }

  const scroll =
    typeof opts.scrollPosition === "number" &&
    Number.isFinite(opts.scrollPosition) &&
    opts.scrollPosition >= 0
      ? Math.trunc(opts.scrollPosition)
      : 0;

  const chunkIndex =
    typeof opts.chunkIndex === "number" && Number.isFinite(opts.chunkIndex)
      ? Math.max(0, Math.trunc(opts.chunkIndex))
      : 0;

  const mode: StoredCourseMode =
    opts.mode === "free" || opts.mode === "mentored" ? opts.mode : "mentored";

  return {
    materialId,
    moduleId,
    lessonIndex,
    scrollPosition: scroll,
    chunkIndex,
    mode,
  };
}

export function lessonKey(moduleId: number, lessonIndex: number): string {
  return `${moduleId}:${lessonIndex}`;
}
