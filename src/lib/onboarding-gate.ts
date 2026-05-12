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
    if (
      /onboarding_completed_at|column|schema cache/i.test(error.message ?? "")
    ) {
      return false;
    }
    console.error("profileNeedsOnboarding:", error.message);
    return false;
  }

  return data?.onboarding_completed_at == null;
}
