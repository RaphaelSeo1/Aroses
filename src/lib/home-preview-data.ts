import type { SupabaseClient } from "@supabase/supabase-js";

/** Lightweight home-page greeting data. */

export type HomePreviewPayload = {
  displayName: string | null;
};

function firstNameFrom(displayName: string | null, email: string): string {
  const fromDisplay = displayName?.trim().split(/\s+/)[0];
  if (fromDisplay) return fromDisplay;
  const local = email.split("@")[0]?.trim();
  if (local) {
    const token = local.split(/[._-]/)[0] ?? local;
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return "there";
}

export function homeGreetingName(
  displayName: string | null,
  email: string
): string {
  return firstNameFrom(displayName, email);
}

export async function loadHomePreviews(
  supabase: SupabaseClient,
  userId: string
): Promise<HomePreviewPayload> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const profile = data as { display_name: string | null } | null;
  return { displayName: profile?.display_name ?? null };
}
