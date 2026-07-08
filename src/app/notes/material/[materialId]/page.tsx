import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { NotesDocView } from "@/components/notes-hub/NotesDocView";
import { createClient } from "@/lib/supabase/server";

/**
 * Notes-hub view of the mentored-learning notes doc for one course
 * material — the same document NotesPanel edits inside the immersive
 * learn surface, reachable here without re-entering the lesson.
 */
export default async function MaterialNotesPage(props: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/notes/material/${materialId}`);
  }

  // RLS scopes visibility (owner + course collaborators).
  const { data: material } = await supabase
    .from("study_materials")
    .select("id, file_name, course_id")
    .eq("id", materialId)
    .maybeSingle();
  if (!material) notFound();

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", material.course_id as string)
    .maybeSingle();

  const title =
    (material.file_name as string)?.replace(/\.[a-z0-9]{2,5}$/i, "").trim() ||
    "Course notes";
  const courseTitle = (course?.title as string) || "Course";

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
                Course notes · {courseTitle}
              </p>
            </div>
            <Link
              href={`/dashboard/courses/${material.course_id}`}
              className="shrink-0 rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Open course
            </Link>
          </div>
          <NotesDocView
            notesEndpoint={`/api/mentored/notes/${materialId}`}
            title={title}
            subtitle={courseTitle}
          />
        </div>
      </main>
    </>
  );
}
