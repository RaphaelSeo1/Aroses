import { notFound, redirect } from "next/navigation";
import { NotesDocView } from "@/components/notes-hub/NotesDocView";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * Tutor-session notes in the same full-screen notes chrome as Live Notes.
 * Past session notes stay readable and editable here after the live runner
 * redirects to recap.
 */
export default async function TutorNotesPage(props: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/notes/tutor/${sessionId}`);
  }

  const { data: session } = await supabase
    .from("tutor_sessions")
    .select(
      "id, title, topic, status, started_at, live_notes_json, updated_at"
    )
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) notFound();

  const title = (session.title as string) || "Tutor session";
  const started = session.started_at
    ? new Date(session.started_at as string).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <NotesDocView
      notesEndpoint={`/api/tutor-session/${sessionId}/notes`}
      tutorSessionId={sessionId}
      title={title}
      subtitle={started ? `Tutor session · ${started}` : "Tutor session"}
      kindLabel="Tutor notes"
      extraAction={
        session.status === "ended"
          ? {
              href: `/tutor-session/recap/${sessionId}`,
              label: "View recap",
            }
          : null
      }
      initialContentJson={session.live_notes_json ?? EMPTY_DOC}
      initialUpdatedAt={(session.updated_at as string) ?? null}
    />
  );
}
