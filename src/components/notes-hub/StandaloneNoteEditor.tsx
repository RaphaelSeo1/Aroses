"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { confirmDialog, promptDialog } from "@/components/AppDialogs";
import { NotesDocView } from "@/components/notes-hub/NotesDocView";

/**
 * Standalone note editor with optional convert-to-course. Notes stay as notes
 * until the user explicitly starts a build.
 */
export function StandaloneNoteEditor({
  noteId,
  initialTitle,
  courseId,
  ingestJobId,
}: {
  noteId: string;
  initialTitle: string;
  courseId: string | null;
  ingestJobId: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTitle = useCallback(
    async (next: string) => {
      const trimmed = next.trim() || "Untitled note";
      setTitle(trimmed);
      await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
    },
    [noteId]
  );

  const handleBuildCourse = async () => {
    if (building) return;
    setError(null);

    if (ingestJobId && courseId) {
      router.push(
        `/dashboard/courses/${courseId}/study/build?pdfJobs=${ingestJobId}`
      );
      return;
    }

    const courseTitle = await promptDialog({
      title: "Build a course from these notes",
      label: "Course title",
      placeholder: title,
      defaultValue: title,
    });
    if (!courseTitle) return;

    const ok = await confirmDialog({
      title: "Start course build?",
      body:
        "Your notes will become the source material for a new course. You can review and edit the text before generation starts. The note itself stays here either way.",
      confirmLabel: "Build course",
    });
    if (!ok) return;

    setBuilding(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/to-course`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseTitle }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect?: string;
        error?: string;
      };
      if (!res.ok || !data.redirect) {
        setError(data.error || "Could not start the course build.");
        setBuilding(false);
        return;
      }
      router.push(data.redirect);
    } catch {
      setError("Could not start the course build. Check your connection.");
      setBuilding(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href="/notes"
            className="text-xs font-medium text-zinc-500 hover:text-violet-700 dark:text-zinc-500 dark:hover:text-violet-300"
          >
            ← All notes
          </Link>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle(title)}
            className="mt-1 block w-full max-w-lg truncate border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-zinc-900 focus:outline-none focus:ring-0 dark:text-zinc-50"
            aria-label="Note title"
          />
          <p className="text-xs text-zinc-500">My notes</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {ingestJobId && courseId ? (
            <Link
              href={`/dashboard/courses/${courseId}/study/build?pdfJobs=${ingestJobId}`}
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              View course build
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void handleBuildCourse()}
              disabled={building}
              className="rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
            >
              {building ? "Starting…" : "Build course from notes"}
            </button>
          )}
        </div>
      </div>
      {error ? (
        <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Keep writing here anytime — building a course copies your notes into the
        course pipeline; this document stays saved.
      </p>
      <NotesDocView
        notesEndpoint={`/api/notes/${noteId}`}
        title={title}
        subtitle="My notes"
      />
    </div>
  );
}
