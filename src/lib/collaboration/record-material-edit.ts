import type { SupabaseClient } from "@supabase/supabase-js";

/** Stamp shared content attribution on study material edits. */
export async function recordStudyMaterialEdit(
  supabase: SupabaseClient,
  materialId: string,
  editorUserId: string
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("study_materials")
    .update({
      last_edited_by: editorUserId,
      last_edited_at: now,
    })
    .eq("id", materialId);
}
