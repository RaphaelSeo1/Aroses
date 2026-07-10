import type { CourseMode } from "@/types/mentored";

/** Stored in `user_course_progress.last_mode` (maps to CourseMode). */
export type StoredCourseMode = CourseMode;

export type CourseProgressRecord = {
  courseId: string;
  materialId: string | null;
  lastModuleId: number | null;
  lastLessonIndex: number;
  lastMode: StoredCourseMode | null;
  lastScrollPosition: number | null;
  lastChunkIndex: number;
  completedLessonKeys: string[];
  lastInteractedAt: string;
};

export type CourseProgressPatch = {
  materialId?: string;
  lastModuleId?: number;
  lastLessonIndex?: number;
  lastMode?: StoredCourseMode;
  lastScrollPosition?: number;
  lastChunkIndex?: number;
  /** Replaces the array when provided. */
  completedLessonKeys?: string[];
  /** Append these keys without duplicating. */
  appendCompletedLessonKeys?: string[];
  /**
   * When false, persist position/mode without refreshing last_interacted_at
   * (e.g. scroll-only saves). Defaults to true.
   */
  bumpInteracted?: boolean;
};
