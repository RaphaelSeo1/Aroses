"use client";

import { useState } from "react";
import { NotesPanel } from "@/components/immersive/NotesPanel";

/**
 * Notes-hub document view — the full NotesPanel editor pointed at an
 * existing notes doc (tutor-session or mentored-course notes), so past
 * notes stay readable AND editable outside their original surface.
 *
 * The auto-generate toggle is hidden here: this is a reference surface,
 * not a live lecture/lesson, so there is nothing to generate from.
 */
export function NotesDocView({
  notesEndpoint,
  title,
  subtitle,
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

  return (
    <div className="h-[calc(100vh-11rem)] min-h-[24rem]">
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
        initialContentJson={initialContentJson}
        initialUpdatedAt={initialUpdatedAt}
        onDocTitleChange={onDocTitleChange}
        lectureRecapEndpoint={lectureRecapEndpoint}
      />
    </div>
  );
}
