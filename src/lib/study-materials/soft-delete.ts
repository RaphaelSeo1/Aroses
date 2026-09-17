import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

/** Soft-delete a study material. Falls back to hard delete if migration 112 is missing. */
export async function softDeleteStudyMaterial(
  supabase: SupabaseClient,
  materialId: string
): Promise<"soft" | "hard" | "fail"> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("study_materials")
    .update({ deleted_at: now })
    .eq("id", materialId)
    .is("deleted_at", null);

  if (!error) return "soft";

  if (isMissingDbColumnError(error, "deleted_at")) {
    const hard = await supabase
      .from("study_materials")
      .delete()
      .eq("id", materialId);
    return hard.error ? "fail" : "hard";
  }

  console.error("[softDeleteStudyMaterial]", error);
  return "fail";
}

export async function restoreStudyMaterial(
  supabase: SupabaseClient,
  materialId: string
): Promise<boolean> {
  const { error } = await supabase
    .from("study_materials")
    .update({ deleted_at: null })
    .eq("id", materialId)
    .not("deleted_at", "is", null);

  if (!error) return true;
  if (isMissingDbColumnError(error, "deleted_at")) return false;
  console.error("[restoreStudyMaterial]", error);
  return false;
}

export async function purgeStudyMaterial(
  supabase: SupabaseClient,
  materialId: string
): Promise<boolean> {
  const { error } = await supabase
    .from("study_materials")
    .delete()
    .eq("id", materialId);
  if (error) {
    console.error("[purgeStudyMaterial]", error);
    return false;
  }
  return true;
}

/** Run a materials query with active-only filter; retry without filter if column missing. */
export async function queryActiveStudyMaterials<T>(
  withFilter: () => PromiseLike<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>,
  withoutFilter: () => PromiseLike<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>
): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> {
  const first = await withFilter();
  if (first.error && isMissingDbColumnError(first.error, "deleted_at")) {
    return withoutFilter();
  }
  return first;
}
