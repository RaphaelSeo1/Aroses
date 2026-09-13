"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NotesPanel } from "@/components/immersive/NotesPanel";

/**
 * Full-screen notes document — same chrome as Live Notes (no site header,
 * viewport-filling editor). Used for course-material and tutor-session notes
 * that live outside a live-lecture capture session.
 */
export function NotesDocView({
  notesEndpoint,
  title,
  subtitle,
  kindLabel = "Notes",
  extraAction = null,
  initialContentJson,
  initialUpdatedAt,
  onDocTitleChange,
  lectureRecapEndpoint = null,
  materialId,
  noteId,
  liveSessionId,
  tutorSessionId,
}: {
  notesEndpoint: string;
  title: string;
  subtitle: string;
  /** Uppercase header kicker — e.g. "Course notes", "Tutor notes". */
  kindLabel?: string;
  extraAction?: { href: string; label: string } | null;
  /** Server-loaded TipTap doc — avoids blank flash before client fetch. */
  initialContentJson?: unknown;
  initialUpdatedAt?: string | null;
  /** Live-sync doc title edits to a parent header (standalone notes). */
  onDocTitleChange?: (title: string) => void;
  /** When set, shows Lecture recap + Generate (live lecture notes). */
  lectureRecapEndpoint?: string | null;
  materialId?: string;
  noteId?: string;
  liveSessionId?: string;
  tutorSessionId?: string;
}) {
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [docTitle, setDocTitle] = useState(title);

  useEffect(() => {
    setDocTitle(title);
  }, [title]);

  useEffect(() => {
    const trimmed = docTitle.trim() || title.trim() || "Untitled note";
    document.title = `${trimmed} · Notes`;
  }, [docTitle, title]);

  return (
    <div className="flex h-dvh flex-col bg-app-gradient">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85 sm:px-6">
        <Link
          href="/notes"
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← All notes
        </Link>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {docTitle.trim() || title.trim() || "Untitled note"}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {kindLabel}
            {subtitle.trim() ? ` · ${subtitle}` : ""}
          </p>
        </div>

        {extraAction ? (
          <Link
            href={extraAction.href}
            className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {extraAction.label}
          </Link>
        ) : null}
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <NotesPanel
            notesEndpoint={notesEndpoint}
            materialId={materialId}
            noteId={noteId}
            liveSessionId={liveSessionId}
            tutorSessionId={tutorSessionId}
            lessonTitle={title}
            courseTitle={subtitle}
            suggestions={[]}
            onConsumeSuggestion={() => {}}
            autoGenerate={autoGenerate}
            onAutoGenerateChange={setAutoGenerate}
            hideAutoGenerate
            fillHeight
            pinToolbar
            initialContentJson={initialContentJson}
            initialUpdatedAt={initialUpdatedAt}
            onDocTitleChange={(next) => {
              setDocTitle(next);
              onDocTitleChange?.(next);
            }}
            lectureRecapEndpoint={lectureRecapEndpoint}
            className="min-h-0 flex-1"
          />
        </main>
      </div>
    </div>
  );
}
