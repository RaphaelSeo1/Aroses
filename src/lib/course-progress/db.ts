import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CourseProgressPatch,
  CourseProgressRecord,
  StoredCourseMode,
} from "@/types/course-progress";

type ProgressRow = {
  course_id: string;
  material_id: string | null;
  last_module_id: number | null;
  last_lesson_index: number | null;
  last_mode: string | null;
  last_scroll_position: number | null;
  last_chunk_index: number | null;
  completed_lesson_keys: unknown;
  last_interacted_at: string;
};

function normalize(row: ProgressRow): CourseProgressRecord {
  const keys = Array.isArray(row.completed_lesson_keys)
    ? (row.completed_lesson_keys as unknown[])
        .filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];
  return {
    courseId: row.course_id,
    materialId: row.material_id,
    lastModuleId:
      typeof row.last_module_id === "number" ? row.last_module_id : null,
    lastLessonIndex:
      typeof row.last_lesson_index === "number" ? row.last_lesson_index : 0,
    lastMode:
      row.last_mode === "free" || row.last_mode === "mentored"
        ? row.last_mode
        : null,
    lastScrollPosition:
      typeof row.last_scroll_position === "number"
        ? row.last_scroll_position
        : null,
    lastChunkIndex:
      typeof row.last_chunk_index === "number" ? row.last_chunk_index : 0,
    completedLessonKeys: keys,
    lastInteractedAt: row.last_interacted_at,
  };
}

export async function loadCourseProgress(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<CourseProgressRecord | null> {
  const { data, error } = await supabase
    .from("user_course_progress")
    .select(
      "course_id, material_id, last_module_id, last_lesson_index, last_mode, last_scroll_position, last_chunk_index, completed_lesson_keys, last_interacted_at"
    )
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (error) {
    console.error("[loadCourseProgress]", error);
    return null;
  }
  if (!data) return null;
  return normalize(data as ProgressRow);
}

export async function upsertCourseProgress(
  supabase: SupabaseClient,
  userId: string,
  courseId: string,
  patch: CourseProgressPatch
): Promise<CourseProgressRecord | null> {
  const now = new Date().toISOString();
  const bumpInteracted = patch.bumpInteracted !== false;

  const { data: existing } = await supabase
    .from("user_course_progress")
    .select("completed_lesson_keys, last_interacted_at")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();

  let completedKeys: string[] = Array.isArray(existing?.completed_lesson_keys)
    ? (existing.completed_lesson_keys as string[])
    : [];

  if (patch.completedLessonKeys) {
    completedKeys = patch.completedLessonKeys;
  } else if (patch.appendCompletedLessonKeys?.length) {
    const set = new Set(completedKeys);
    for (const k of patch.appendCompletedLessonKeys) {
      if (k) set.add(k);
    }
    completedKeys = [...set];
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    course_id: courseId,
    updated_at: now,
  };
  // Always set on first insert (NOT NULL); otherwise only when bumping.
  if (bumpInteracted || !existing) {
    row.last_interacted_at = now;
  }

  if (typeof patch.materialId === "string") row.material_id = patch.materialId;
  if (typeof patch.lastModuleId === "number") {
    row.last_module_id = patch.lastModuleId;
  }
  if (typeof patch.lastLessonIndex === "number") {
    row.last_lesson_index = patch.lastLessonIndex;
  }
  if (patch.lastMode === "mentored" || patch.lastMode === "free") {
    row.last_mode = patch.lastMode;
  }
  if (typeof patch.lastScrollPosition === "number") {
    row.last_scroll_position = patch.lastScrollPosition;
  }
  if (typeof patch.lastChunkIndex === "number") {
    row.last_chunk_index = patch.lastChunkIndex;
  }
  if (
    patch.completedLessonKeys ||
    patch.appendCompletedLessonKeys?.length
  ) {
    row.completed_lesson_keys = completedKeys;
  }

  const { data, error } = await supabase
    .from("user_course_progress")
    .upsert(row, { onConflict: "user_id,course_id" })
    .select(
      "course_id, material_id, last_module_id, last_lesson_index, last_mode, last_scroll_position, last_chunk_index, completed_lesson_keys, last_interacted_at"
    )
    .maybeSingle();

  if (error) {
    console.error("[upsertCourseProgress]", error);
    return null;
  }
  if (!data) return null;
  return normalize(data as ProgressRow);
}

export async function listRecentCourseProgress(
  supabase: SupabaseClient,
  userId: string,
  limit = 10
): Promise<CourseProgressRecord[]> {
  const { data, error } = await supabase
    .from("user_course_progress")
    .select(
      "course_id, material_id, last_module_id, last_lesson_index, last_mode, last_scroll_position, last_chunk_index, completed_lesson_keys, last_interacted_at"
    )
    .eq("user_id", userId)
    .order("last_interacted_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[listRecentCourseProgress]", error);
    return [];
  }
  return (data ?? []).map((r) => normalize(r as ProgressRow));
}

export function storedModeToCourseMode(
  mode: StoredCourseMode | null
): StoredCourseMode {
  return mode === "free" ? "free" : "mentored";
}
