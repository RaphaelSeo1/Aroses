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
 *   1. Most-recently-completed module in this course → the NEXT module
 *      of that material (or the same module if it was the last one).
 *      This gives the natural "resume where I left off" feel.
 *   2. Earliest material (lowest sort_order, then earliest created_at)
 *      with at least one generated module → module 1.
 *   3. Whatever material exists at all → module 1.
 *   4. `null` if the course is empty (caller should render an empty state).
 *
 * Designed to run server-side from a Next.js route handler / page.
 */
export async function resolveResumeTarget(
  supabase: SupabaseClient,
  courseId: string,
  userId: string
): Promise<ResumeTarget | null> {
  // 1. Did this user complete anything in this course before? Pick up
  //    from the freshest completion.
  const { data: lastComp } = await supabase
    .from("module_completion")
    .select("material_id, module_id, completed_at, study_materials!inner(course_id)")
    .eq("user_id", userId)
    .eq("study_materials.course_id", courseId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastComp && typeof lastComp.material_id === "string") {
    const materialId = lastComp.material_id;
    const lastModuleId =
      typeof lastComp.module_id === "number" ? lastComp.module_id : null;

    // Pull the matching material's outline so we can find the NEXT
    // unfinished module — that's almost always what a learner expects
    // when they tap "Continue".
    const { data: mat } = await supabase
      .from("study_materials")
      .select("id, course_payload")
      .eq("id", materialId)
      .maybeSingle();

    const modules = extractModuleIds(mat?.course_payload);
    if (modules.length > 0 && lastModuleId != null) {
      const idx = modules.indexOf(lastModuleId);
      if (idx >= 0 && idx < modules.length - 1) {
        return { materialId, moduleId: modules[idx + 1] };
      }
      // Either the completed module was the last one, or we couldn't
      // match it — just stay on the last completed module so the user
      // sees something familiar.
      return {
        materialId,
        moduleId: lastModuleId,
      };
    }
    return { materialId, moduleId: lastModuleId };
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
