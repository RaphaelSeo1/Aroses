import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { NotesDocView } from "@/components/notes-hub/NotesDocView";
import { createClient } from "@/lib/supabase/server";

/**
 * Notes-hub view of a tutor session's live notes. The active session
 * surface disappears once the session ends (it redirects to the recap,
 * which shows AI recap markdown — not these notes), so this is where past
 * session notes stay readable and editable.
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
    .select("id, title, topic, status, started_at")
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
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <Link
                href="/notes"
                className="text-xs font-medium text-zinc-500 hover:text-violet-700 dark:text-zinc-500 dark:hover:text-violet-300"
              >
                ← All notes
              </Link>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {title}
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                Tutor session{started ? ` · ${started}` : ""}
              </p>
            </div>
            {session.status === "ended" ? (
              <Link
                href={`/tutor-session/recap/${sessionId}`}
                className="shrink-0 rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                View recap
              </Link>
            ) : null}
          </div>
          <NotesDocView
            notesEndpoint={`/api/tutor-session/${sessionId}/notes`}
            title={title}
            subtitle="Tutor session notes"
          />
        </div>
      </main>
    </>
  );
}
