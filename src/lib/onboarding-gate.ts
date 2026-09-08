import type { SupabaseClient } from "@supabase/supabase-js";

export type OnboardingState = "complete" | "required" | "unavailable";

export async function getProfileOnboardingState(
  supabase: SupabaseClient,
  userId: string
): Promise<OnboardingState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();

  if (!error) {
    return data?.onboarding_completed_at == null ? "required" : "complete";
  }

  const msg = error.message ?? "";
  const missingOnboardingColumn =
    /onboarding_completed_at/i.test(msg) &&
    (/does not exist|schema cache|could not find|42703/i.test(msg) ||
      /column/i.test(msg));
  if (missingOnboardingColumn) {
    return "required";
  }

  console.error("getProfileOnboardingState:", error.message);
  return "unavailable";
}

/**
 * Returns true when the user must complete `/onboarding` before the rest of the app.
 * Missing profile row or null `onboarding_completed_at` means onboarding is required.
 */
export async function profileNeedsOnboarding(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await getProfileOnboardingState(supabase, userId)) === "required";
}
