import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { assertCanStartLectureRecording } from "@/lib/billing/lecture-recording-cap";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * Standalone note entry — always opens the Live Notes surface (transcript +
 * editor). The old NotesDocView page is no longer the primary destination.
 */
export default async function StandaloneNotePage(props: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/notes/doc/${noteId}`);
  }

  const { data: note } = await supabase
    .from("user_notes")
    .select("id, title, content_json, content_text")
    .eq("id", noteId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!note) notFound();

  const userId = user.id;
  after(() => {
    void supabase
      .from("user_notes")
      .update({ last_opened_at: new Date().toISOString() })
      .eq("id", noteId)
      .eq("user_id", userId)
      .then(({ error }) => {
        if (error && !/last_opened_at/i.test(error.message ?? "")) {
          console.error("[notes last_opened_at]", error);
        }
      });
  });

  const { data: active } = await supabase
    .from("live_lecture_sessions")
    .select("id")
    .eq("user_note_id", noteId)
    .eq("user_id", user.id)
    .in("status", ["recording", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active?.id) {
    redirect(`/notes/doc/${noteId}/record/${active.id}`);
  }

  const { data: latest } = await supabase
    .from("live_lecture_sessions")
    .select("id, status")
    .eq("user_note_id", noteId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.id) {
    if (latest.status !== "recording" && latest.status !== "paused") {
      await supabase
        .from("live_lecture_sessions")
        .update({
          status: "paused",
          updated_at: new Date().toISOString(),
        })
        .eq("id", latest.id)
        .eq("user_id", user.id);
    }
    redirect(`/notes/doc/${noteId}/record/${latest.id}`);
  }

  const cap = await assertCanStartLectureRecording(user.id);
  if (!cap.ok) {
    redirect(
      `/dashboard/billing?lectureCap=1&used=${cap.used}&cap=${cap.cap}`
    );
  }

  const title =
    typeof note.title === "string" && note.title.trim()
      ? note.title.trim().slice(0, 200)
      : "Untitled note";

  const { data: created, error } = await supabase
    .from("live_lecture_sessions")
    .insert({
      user_id: user.id,
      user_note_id: noteId,
      course_id: null,
      title,
      status: "paused",
      notes_json: note.content_json ?? EMPTY_DOC,
      notes_text:
        typeof note.content_text === "string" ? note.content_text : "",
    })
    .select("id")
    .single();

  if (error || !created?.id) {
    console.error("[notes/doc] ensure session", error);
    notFound();
  }

  redirect(`/notes/doc/${noteId}/record/${created.id}`);
}
