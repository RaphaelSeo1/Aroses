import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the module id the student last worked on in Mentored Learning
 * for a given study material, or null if no session row exists yet.
 */
export async function resolveMentoredModuleForMaterial(
  supabase: SupabaseClient,
  userId: string,
  materialId: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("user_mentored_sessions")
    .select("module_id")
    .eq("user_id", userId)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    console.error("[resolveMentoredModuleForMaterial]", error);
    return null;
  }
  return typeof data?.module_id === "number" ? data.module_id : null;
}
