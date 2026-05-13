import type { SupabaseClient } from "@supabase/supabase-js";

export async function canReadStudyMaterial(
  supabase: SupabaseClient,
  materialId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("study_materials")
    .select("id")
    .eq("id", materialId)
    .maybeSingle();
  return !error && data != null;
}
