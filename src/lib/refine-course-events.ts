import type { CourseModule, CoursePayload } from "@/types/course";

export const AROSES_COURSE_REFINED_EVENT = "aroses-course-refined";
/** Fired when the student confirms apply — drawer may close while work continues. */
export const AROSES_COURSE_REFINE_APPLY_START_EVENT =
  "aroses-course-refine-apply-start";
/** Progressive module patch while refine is applying (before final save refresh). */
export const AROSES_COURSE_REFINE_PATCH_EVENT = "aroses-course-refine-patch";
/** Token-level lesson body updates while the preferred module is streaming. */
export const AROSES_COURSE_REFINE_LESSON_DELTA_EVENT =
  "aroses-course-refine-lesson-delta";
/** Surgical in-place edit: move the caret to `start` and delete/type there. */
export const AROSES_COURSE_REFINE_LESSON_EDIT_EVENT =
  "aroses-course-refine-lesson-edit";
/** Pre-confirm preview: hover a caret over the exact spans about to change. */
export const AROSES_COURSE_REFINE_PREVIEW_EVENT =
  "aroses-course-refine-preview";

export type ArosesCourseRefinedDetail = {
  materialId: string;
};

export type ArosesCourseRefineApplyStartDetail = {
  materialId: string;
};

export type ArosesCourseRefinePatchDetail = {
  materialId: string;
  module: CourseModule;
  /** Optional full course snapshot after this patch (preferred when present). */
  course?: CoursePayload;
  actionIndex?: number;
  actionTotal?: number;
};

export type ArosesCourseRefineLessonDeltaDetail = {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  content: string;
  complete: boolean;
};

export type ArosesCourseRefineLessonEditDetail = {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  /** Offset in the lesson content (as the client currently has it). */
  start: number;
  /** Characters to delete at `start`. */
  deleteLen: number;
  /** Text to type in at `start` after the deletion. */
  insert: string;
};

export type ArosesCourseRefinePreviewEdit = {
  moduleId: number;
  lessonIndex: number;
  kind: "content" | "key_term" | "example";
  start?: number;
  deleteLen?: number;
  insert?: string;
  term?: string;
  definition?: string;
  example?: string;
  action?: "add" | "remove" | "replace";
};

export type ArosesCourseRefinePreviewDetail = {
  materialId: string;
  /** Spans about to change. Empty array clears the preview. */
  edits: ArosesCourseRefinePreviewEdit[];
};
