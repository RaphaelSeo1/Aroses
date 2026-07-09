import { redirect, notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { StandaloneNoteEditor } from "@/components/notes-hub/StandaloneNoteEditor";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, title, course_id, ingest_job_id")
    .eq("id", noteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!note) notFound();

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          <StandaloneNoteEditor
            noteId={note.id as string}
            initialTitle={(note.title as string) || "Untitled note"}
            courseId={(note.course_id as string) ?? null}
            ingestJobId={(note.ingest_job_id as string) ?? null}
          />
        </div>
      </main>
    </>
  );
}
