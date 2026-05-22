import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoursePayload } from "@/types/course";

export type ResumeTarget = {
  materialId: string;
  /** The module to land on. `null` means "first module of the material". */
  moduleId: number | null;
};

/**
 * Resolves where to drop a user when they click "Learn the course" /
 * "Continue learning" without a specific material/module already in the
 * URL. Resolution order:
 *
 *   1. Most recent activity in this course (latest module completion OR
 *      latest answered quiz question) → return that exact module so the
 *      learner lands where they were last working, not on some "next"
 *      module the system guessed.
 *   2. Earliest material (lowest sort_order, then earliest created_at)
 *      with at least one generated module → module 1. This branch is
 *      only used when the learner has zero activity in the course.
 *   3. Whatever material exists at all → module 1 / still-building state.
 *   4. `null` if the course is empty (caller renders empty state).
 *
 * Designed to run server-side from a Next.js route handler / page.
 */
export async function resolveResumeTarget(
  supabase: SupabaseClient,
  courseId: string,
  userId: string
): Promise<ResumeTarget | null> {
  // 1a. Most recent Mentored Learning session — gives us BOTH the
  //     material and the exact module the student was on, even if
  //     they exited mid-module without completing it. This is the
  //     strongest signal because we always update `last_seen_at`
  //     on every Mentored turn, while module_completion only fires
  //     when a module is fully finished. Without this branch, a
  //     student who exits mid-module gets bounced back to module 1
  //     of the course on return (the bug we're fixing here).
  const { data: lastMentored } = await supabase
    .from("user_mentored_sessions")
    .select(
      "material_id, module_id, last_seen_at, study_materials!inner(course_id)"
    )
    .eq("user_id", userId)
    .eq("study_materials.course_id", courseId)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 1b. Latest module completion — the strongest "I finished this"
  //     signal. Carries both material AND module, but only fires
  //     when the student actually reaches the end of a module.
  const { data: lastComp } = await supabase
    .from("module_completion")
    .select("material_id, module_id, completed_at, study_materials!inner(course_id)")
    .eq("user_id", userId)
    .eq("study_materials.course_id", courseId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 1c. Latest quiz attempt — used as a fallback "this user touched
  //     this course" signal. We only get material_id from this table
  //     (no module_id column), so module resolution falls back to the
  //     first available module of that material.
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

  // Whichever signal is freshest wins. Mentored sessions tend to be
  // freshest because last_seen_at updates on every turn — that's
  // exactly the "drop me back where I left off" semantic we want.
  const freshest = Math.max(mentoredAt, compAt, attemptAt);

  if (freshest > 0 && freshest === mentoredAt && lastMentored) {
    return {
      materialId: lastMentored.material_id as string,
      moduleId:
        typeof lastMentored.module_id === "number"
          ? lastMentored.module_id
          : null,
    };
  }

  if (freshest > 0 && freshest === compAt && lastComp) {
    return {
      materialId: lastComp.material_id as string,
      moduleId:
        typeof lastComp.module_id === "number" ? lastComp.module_id : null,
    };
  }

  if (
    freshest > 0 &&
    freshest === attemptAt &&
    lastAttempt &&
    typeof lastAttempt.material_id === "string"
  ) {
    // We know which material was being practised but not which module —
    // load its outline and return module 1 (better than bouncing the
    // user to a different material entirely).
    const matId = lastAttempt.material_id;
    const { data: mat } = await supabase
      .from("study_materials")
      .select("id, course_payload")
      .eq("id", matId)
      .maybeSingle();
    const ids = extractModuleIds(mat?.course_payload);
    return { materialId: matId, moduleId: ids[0] ?? null };
  }

  // 2. No completions yet — fall back to the earliest material that
  //    actually has modules built. Two queries are cheaper than loading
  //    every payload, but we have to filter `course_payload` client-side
  //    since Supabase can't easily say "modules is non-empty array".
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
        return { materialId: m.id, moduleId: ids[0] };
      }
    }
    // 3. No materials have built modules yet — return the earliest one
    //    so the caller can still render its "course is still building"
    //    state instead of bouncing back to the workspace.
    return { materialId: materials[0].id, moduleId: null };
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
