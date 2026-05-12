import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns true when the user must complete `/onboarding` before the rest of the app.
 * Missing profile row or null `onboarding_completed_at` means onboarding is required.
 */
export async function profileNeedsOnboarding(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const msg = error.message ?? "";
    // If migration 026 is not applied yet, PostgREST errors on this column.
    // Returning true sends the user to `/onboarding` (complete API will 503 until migrated).
    const missingOnboardingColumn =
      /onboarding_completed_at/i.test(msg) &&
      (/does not exist|schema cache|could not find|42703/i.test(msg) ||
        /column/i.test(msg));
    if (missingOnboardingColumn) {
      return true;
    }
    console.error("profileNeedsOnboarding:", error.message);
    return false;
  }

  return data?.onboarding_completed_at == null;
}
