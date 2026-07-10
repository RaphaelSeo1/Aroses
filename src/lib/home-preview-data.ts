import type { SupabaseClient } from "@supabase/supabase-js";

/** Lightweight home-page greeting + recent activity for Welcome back. */

export type HomeActivityPreview = {
  kind: "standalone_note" | "course_note" | "live" | "tutor";
  id: string;
  title: string;
  href: string;
  at: string;
  live?: boolean;
};

export type HomePreviewPayload = {
  displayName: string | null;
  /** Freshest non-course activity candidates (notes / live / tutor). */
  recentActivity: HomeActivityPreview[];
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

function fresherIso(a: string | null | undefined, b: string | null | undefined): string {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (aOk && bOk) return ta >= tb ? (a as string) : (b as string);
  if (aOk) return a as string;
  if (bOk) return b as string;
  return new Date(0).toISOString();
}

export async function loadHomePreviews(
  supabase: SupabaseClient,
  userId: string
): Promise<HomePreviewPayload> {
  const [profileRes, sessionsRes, liveRes, courseNotesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("tutor_sessions")
      .select("id, title, updated_at, started_at, status")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(3),
    supabase
      .from("live_lecture_sessions")
      .select(
        "id, course_id, user_note_id, title, status, updated_at, started_at"
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(3),
    supabase
      .from("user_course_notes")
      .select("material_id, updated_at, content_text")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(3),
  ]);

  // Prefer last_opened_at when migration 085 is applied; fall back if missing.
  type NoteRow = {
    id: string;
    title: string;
    updated_at: string;
    last_opened_at?: string | null;
  };
  let noteRows: NoteRow[] = [];
  {
    const withOpened = await supabase
      .from("user_notes")
      .select("id, title, updated_at, last_opened_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(8);
    if (
      withOpened.error &&
      /last_opened_at/i.test(withOpened.error.message ?? "")
    ) {
      const fallback = await supabase
        .from("user_notes")
        .select("id, title, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (fallback.error) {
        console.error("[home-previews notes]", fallback.error);
      } else {
        noteRows = (fallback.data ?? []) as NoteRow[];
      }
    } else if (withOpened.error) {
      console.error("[home-previews notes]", withOpened.error);
    } else {
      noteRows = (withOpened.data ?? []) as NoteRow[];
    }
  }
  if (sessionsRes.error) {
    console.error("[home-previews tutor]", sessionsRes.error);
  }
  if (liveRes.error) {
    console.error("[home-previews live]", liveRes.error);
  }
  if (courseNotesRes.error) {
    console.error("[home-previews course-notes]", courseNotesRes.error);
  }

  const profile = profileRes.data as { display_name: string | null } | null;
  const recentActivity: HomeActivityPreview[] = [];

  for (const n of noteRows) {
    const id = n.id;
    const at = fresherIso(n.updated_at, n.last_opened_at);
    recentActivity.push({
      kind: "standalone_note",
      id,
      title:
        typeof n.title === "string" && n.title.trim()
          ? n.title.trim()
          : "Untitled note",
      href: `/notes/doc/${id}`,
      at,
    });
  }

  for (const s of sessionsRes.data ?? []) {
    const id = s.id as string;
    const status = typeof s.status === "string" ? s.status : "completed";
    const live = status === "active" || status === "paused";
    recentActivity.push({
      kind: "tutor",
      id,
      title:
        typeof s.title === "string" && s.title.trim()
          ? s.title.trim()
          : "Tutor session",
      href: live
        ? `/tutor-session/active/${id}`
        : `/tutor-session/recap/${id}`,
      at:
        (s.updated_at as string) ||
        (s.started_at as string) ||
        new Date(0).toISOString(),
      live,
    });
  }

  for (const s of liveRes.data ?? []) {
    const id = s.id as string;
    const noteId = s.user_note_id as string | null;
    const courseId = s.course_id as string | null;
    const status = typeof s.status === "string" ? s.status : "completed";
    const live = status === "recording" || status === "paused";
    // Prefer the linked standalone note when present (same doc the user edits).
    if (noteId) continue;
    if (!courseId) continue;
    recentActivity.push({
      kind: "live",
      id,
      title:
        typeof s.title === "string" && s.title.trim()
          ? s.title.trim()
          : "Live lecture",
      href: `/dashboard/courses/${courseId}/live-notes/${id}`,
      at:
        (s.updated_at as string) ||
        (s.started_at as string) ||
        new Date(0).toISOString(),
      live,
    });
  }

  const courseNotes = (courseNotesRes.data ?? []).filter(
    (n) => typeof n.content_text === "string" && n.content_text.trim()
  );
  const materialIds = courseNotes
    .map((n) => n.material_id as string)
    .filter(Boolean);
  if (materialIds.length > 0) {
    const { data: materials } = await supabase
      .from("study_materials")
      .select("id, file_name")
      .in("id", materialIds);
    const titleById = new Map(
      (materials ?? []).map((m) => [
        m.id as string,
        ((m.file_name as string) || "Course notes").replace(/\.[^.]+$/, ""),
      ])
    );
    for (const n of courseNotes) {
      const materialId = n.material_id as string;
      recentActivity.push({
        kind: "course_note",
        id: materialId,
        title: titleById.get(materialId) || "Course notes",
        href: `/notes/material/${materialId}`,
        at: (n.updated_at as string) || new Date(0).toISOString(),
      });
    }
  }

  recentActivity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    displayName: profile?.display_name ?? null,
    recentActivity: recentActivity.slice(0, 8),
  };
}
