import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoursePayload } from "@/types/course";
import { loadCourseProgress } from "@/lib/course-progress/db";
import type { StoredCourseMode } from "@/types/course-progress";
import type { CourseMode } from "@/types/mentored";

export type ResumeTarget = {
  materialId: string;
  /** The module to land on. `null` means "first module of the material". */
  moduleId: number | null;
  lessonIndex?: number | null;
  scrollPosition?: number | null;
  chunkIndex?: number | null;
  mode?: StoredCourseMode | null;
};

async function loadMaterialModePref(
  supabase: SupabaseClient,
  userId: string,
  materialId: string
): Promise<CourseMode | null> {
  const { data } = await supabase
    .from("user_course_mode_prefs")
    .select("mode")
    .eq("user_id", userId)
    .eq("material_id", materialId)
    .maybeSingle();
  if (data?.mode === "free" || data?.mode === "mentored") {
    return data.mode;
  }
  return null;
}

/**
 * Resolves where to drop a user when they open a course without explicit
 * material/module in the URL.
 *
 * Priority:
 *   0. `user_course_progress` for this course (single source of truth)
 *   1. Legacy signals: mentored session, module completion, quiz attempts
 *   2. First material with modules
 */
export async function resolveResumeTarget(
  supabase: SupabaseClient,
  courseId: string,
  userId: string
): Promise<ResumeTarget | null> {
  const saved = await loadCourseProgress(supabase, userId, courseId);
  if (saved?.materialId) {
    const { data: mat } = await supabase
      .from("study_materials")
      .select("id, course_payload")
      .eq("id", saved.materialId)
      .eq("course_id", courseId)
      .maybeSingle();

    if (mat) {
      const ids = extractModuleIds(mat.course_payload);
      if (ids.length > 0) {
        const moduleId =
          saved.lastModuleId != null && ids.includes(saved.lastModuleId)
            ? saved.lastModuleId
            : ids[0];
        return {
          materialId: saved.materialId,
          moduleId,
          lessonIndex: saved.lastLessonIndex,
          scrollPosition: saved.lastScrollPosition,
          chunkIndex: saved.lastChunkIndex,
          mode: saved.lastMode,
        };
      }
    }
  }

  const { data: lastMentored } = await supabase
    .from("user_mentored_sessions")
    .select(
      "material_id, module_id, chunk_index, last_seen_at, study_materials!inner(course_id)"
    )
    .eq("user_id", userId)
    .eq("study_materials.course_id", courseId)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastComp } = await supabase
    .from("module_completion")
    .select("material_id, module_id, completed_at, study_materials!inner(course_id)")
    .eq("user_id", userId)
    .eq("study_materials.course_id", courseId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastAttempt } = await supabase
    .from("question_attempts")
    .select("material_id, answered_at, study_materials!inner(course_id)")
    .eq("user_id", userId)
    .eq("study_materials.course_id", courseId)
    .order("answered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mentoredAt = lastMentored?.last_seen_at
    ? new Date(lastMentored.last_seen_at as string).getTime()
    : 0;
  const compAt = lastComp?.completed_at
    ? new Date(lastComp.completed_at as string).getTime()
    : 0;
  const attemptAt = lastAttempt?.answered_at
    ? new Date(lastAttempt.answered_at as string).getTime()
    : 0;

  const freshest = Math.max(mentoredAt, compAt, attemptAt);

  if (freshest > 0 && freshest === mentoredAt && lastMentored) {
    const materialId = lastMentored.material_id as string;
    const modePref = await loadMaterialModePref(supabase, userId, materialId);
    console.log("[mode-persist] resume legacy mentored", {
      materialId,
      modePref,
    });
    return {
      materialId,
      moduleId:
        typeof lastMentored.module_id === "number" &&
        lastMentored.module_id > 0
          ? lastMentored.module_id
          : null,
      chunkIndex:
        typeof lastMentored.chunk_index === "number"
          ? lastMentored.chunk_index
          : null,
      mode: modePref ?? "mentored",
    };
  }

  if (freshest > 0 && freshest === compAt && lastComp) {
    const materialId = lastComp.material_id as string;
    const modePref = await loadMaterialModePref(supabase, userId, materialId);
    console.log("[mode-persist] resume legacy completion", {
      materialId,
      modePref,
    });
    return {
      materialId,
      moduleId:
        typeof lastComp.module_id === "number" && lastComp.module_id > 0
          ? lastComp.module_id
          : null,
      mode: modePref ?? "free",
    };
  }

  if (
    freshest > 0 &&
    freshest === attemptAt &&
    lastAttempt &&
    typeof lastAttempt.material_id === "string"
  ) {
    const matId = lastAttempt.material_id;
    const modePref = await loadMaterialModePref(supabase, userId, matId);
    const { data: mat } = await supabase
      .from("study_materials")
      .select("id, course_payload")
      .eq("id", matId)
      .maybeSingle();
    const ids = extractModuleIds(mat?.course_payload);
    console.log("[mode-persist] resume legacy attempt", {
      materialId: matId,
      modePref,
    });
    return {
      materialId: matId,
      moduleId: ids[0] ?? null,
      mode: modePref ?? "free",
    };
  }

  const { data: materials } = await supabase
    .from("study_materials")
    .select("id, course_payload, sort_order, created_at")
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (materials?.length) {
    for (const m of materials) {
      const ids = extractModuleIds(m.course_payload);
      if (ids.length > 0) {
        return { materialId: m.id, moduleId: ids[0], mode: "mentored" };
      }
    }
    return { materialId: materials[0].id, moduleId: null, mode: "mentored" };
  }

  return null;
}

function extractModuleIds(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const modules = (payload as CoursePayload).modules;
  if (!Array.isArray(modules)) return [];
  return modules
    .map((m) => (typeof m?.id === "number" ? m.id : null))
    .filter((id): id is number => id != null);
}
