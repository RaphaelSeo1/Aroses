import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { liveNotesToSourceMarkdown } from "@/lib/live-notes/notes-review";

/** Content already inside Aroses that can become a course. */
export type AppSourceKind = "note" | "live_session" | "tutor_session";

export type LoadedAppSource = { kind: AppSourceKind; refId: string; label: string; text: string };

const MAX_CHARS = 200_000;

function section(title: string, body: string | null | undefined): string {
  const t = body?.trim();
  return t ? `## ${title}\n\n${t}` : "";
}

/**
 * Reads the text with the student's own client, so RLS decides what they can
 * turn into a course. Returns null when the item doesn't exist or isn't theirs.
 */
export async function loadAppSource(
  supabase: SupabaseClient,
  userId: string,
  kind: AppSourceKind,
  id: string
): Promise<LoadedAppSource | null> {
  if (kind === "note") {
    const { data } = await supabase
      .from("user_notes")
      .select("id, title, content_json, content_text")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    const text = liveNotesToSourceMarkdown(data.content_json) || String(data.content_text ?? "");
    return { kind, refId: data.id, label: data.title || "Note", text: text.slice(0, MAX_CHARS) };
  }

  if (kind === "live_session") {
    const { data } = await supabase
      .from("live_lecture_sessions")
      .select("id, title, notes_json, notes_text")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    const { data: segments } = await supabase
      .from("live_lecture_segments")
      .select("text")
      .eq("session_id", id)
      .order("seq", { ascending: true })
      .limit(5000);
    const notes = liveNotesToSourceMarkdown(data.notes_json) || String(data.notes_text ?? "");
    const transcript = (segments ?? []).map((s) => String(s.text ?? "").trim()).filter(Boolean).join(" ");
    const text = [section("Lecture notes", notes), section("Lecture transcript", transcript)].filter(Boolean).join("\n\n");
    return { kind, refId: data.id, label: data.title || "Live lecture", text: text.slice(0, MAX_CHARS) };
  }

  const { data } = await supabase
    .from("tutor_sessions")
    .select("id, title, recap_markdown, live_notes_json, live_notes_text, conversation_transcript, reference_summary")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const turns = Array.isArray(data.conversation_transcript)
    ? (data.conversation_transcript as Array<{ role?: string; content?: unknown }>)
        .map((m) => {
          const content = typeof m.content === "string" ? m.content.trim() : "";
          return content ? `${m.role === "user" ? "Student" : "Rose"}: ${content}` : "";
        })
        .filter(Boolean)
        .join("\n\n")
    : "";
  const notes = liveNotesToSourceMarkdown(data.live_notes_json) || String(data.live_notes_text ?? "");
  const text = [
    section("Session recap", data.recap_markdown),
    section("Session notes", notes),
    section("Reference materials", data.reference_summary),
    section("Conversation", turns),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind, refId: data.id, label: data.title || "Tutor session", text: text.slice(0, MAX_CHARS) };
}
