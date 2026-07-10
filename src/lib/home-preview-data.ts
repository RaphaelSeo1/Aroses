import type { SupabaseClient } from "@supabase/supabase-js";

/** Lightweight home-page previews — cheap limit queries only. */

export type HomeNotePreview = {
  id: string;
  title: string;
  updatedAt: string;
};

export type HomeTutorSessionPreview = {
  id: string;
  title: string;
  updatedAt: string;
};

export type HomePreviewPayload = {
  displayName: string | null;
  recentNotes: HomeNotePreview[];
  recentTutorSessions: HomeTutorSessionPreview[];
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
  const [profileRes, notesRes, sessionsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("user_notes")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(2),
    supabase
      .from("tutor_sessions")
      .select("id, title, updated_at, started_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  const profile = profileRes.data as { display_name: string | null } | null;

  const recentNotes: HomeNotePreview[] = (notesRes.data ?? []).map((n) => ({
    id: n.id as string,
    title:
      typeof n.title === "string" && n.title.trim()
        ? n.title.trim()
        : "Untitled note",
    updatedAt: (n.updated_at as string) ?? new Date().toISOString(),
  }));

  const recentTutorSessions: HomeTutorSessionPreview[] = (
    sessionsRes.data ?? []
  ).map((s) => ({
    id: s.id as string,
    title:
      typeof s.title === "string" && s.title.trim()
        ? s.title.trim()
        : "Tutor session",
    updatedAt:
      (s.updated_at as string) ||
      (s.started_at as string) ||
      new Date().toISOString(),
  }));

  return {
    displayName: profile?.display_name ?? null,
    recentNotes,
    recentTutorSessions,
  };
}
