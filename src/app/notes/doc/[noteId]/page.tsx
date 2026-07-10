import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { StandaloneNoteEditor } from "@/components/notes-hub/StandaloneNoteEditor";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

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

  // Load note + active session in parallel so the page isn't blocked on
  // sequential round-trips before content can render.
  const [noteRes, activeSessionRes] = await Promise.all([
    supabase
      .from("user_notes")
      .select(
        "id, title, content_json, updated_at, course_id, ingest_job_id"
      )
      .eq("id", noteId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("live_lecture_sessions")
      .select("id")
      .eq("user_note_id", noteId)
      .eq("user_id", user.id)
      .in("status", ["recording", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const note = noteRes.data;
  if (!note) notFound();

  // Don't block first paint on last_opened_at (Welcome back tracking).
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

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          <StandaloneNoteEditor
            noteId={note.id as string}
            initialTitle={(note.title as string) || "Untitled note"}
            initialContentJson={note.content_json ?? EMPTY_DOC}
            initialUpdatedAt={(note.updated_at as string) ?? null}
            initialActiveSessionId={
              (activeSessionRes.data?.id as string) ?? null
            }
            courseId={(note.course_id as string) ?? null}
            ingestJobId={(note.ingest_job_id as string) ?? null}
          />
        </div>
      </main>
    </>
  );
}
