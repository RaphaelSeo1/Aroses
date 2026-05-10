"use client";

import { useCallback, useEffect, useState } from "react";

type NoteRow = {
  id: string;
  lesson_index: number;
  highlight_excerpt: string;
  note_body: string;
  updated_at: string;
};

export function LessonNotesCapture({
  materialId,
  moduleId,
  lessonIndex,
  lessonTitle,
}: {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  lessonTitle: string;
}) {
  const [highlight, setHighlight] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/study-materials/${materialId}/lesson-notes?moduleId=${moduleId}&lessonIndex=${lessonIndex}`
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNoteId(null);
        setHighlight("");
        setNoteBody("");
        setLoading(false);
        return;
      }
      const rows = (j.notes ?? []) as NoteRow[];
      const row = rows[0];
      if (row) {
        setNoteId(row.id);
        setHighlight(row.highlight_excerpt ?? "");
        setNoteBody(row.note_body ?? "");
      } else {
        setNoteId(null);
        setHighlight("");
        setNoteBody("");
      }
    } catch {
      setNoteId(null);
    }
    setLoading(false);
  }, [materialId, moduleId, lessonIndex]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const trimmedH = highlight.trim();
      const trimmedN = noteBody.trim();
      if (trimmedH.length === 0 && trimmedN.length === 0) {
        setMessage("Add a highlight or a note before saving.");
        setSaving(false);
        return;
      }

      const res = noteId
        ? await fetch(`/api/study-materials/${materialId}/lesson-notes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: noteId,
              highlightExcerpt: trimmedH,
              noteBody: trimmedN,
            }),
          })
        : await fetch(`/api/study-materials/${materialId}/lesson-notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              moduleId,
              lessonIndex,
              highlightExcerpt: trimmedH,
              noteBody: trimmedN,
            }),
          });

      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setMessage("Sign in to save private notes for this lesson.");
        setSaving(false);
        return;
      }
      if (!res.ok) {
        const err =
          typeof j.error === "string" ? j.error : "Could not save notes.";
        const hint =
          typeof j.hint === "string" && j.hint.trim().length > 0
            ? ` ${j.hint}`
            : "";
        setMessage(`${err}${hint}`);
        setSaving(false);
        return;
      }
      if (!noteId && j.note?.id) {
        setNoteId(j.note.id as string);
      }
      setMessage("Saved — you can quiz this from the practice room.");
      await load();
    } catch {
      setMessage("Network error.");
    }
    setSaving(false);
  }

  return (
    <div className="mt-8 rounded-2xl border border-zinc-200/90 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Your notes &amp; highlights
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Private to your account — paste what stood out from{" "}
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {lessonTitle}
        </span>
        , then generate focus questions on the practice tab.
      </p>
      {loading ? (
        <p className="mt-3 text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Highlight / excerpt
            </span>
            <textarea
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
              rows={3}
              placeholder="Paste the sentence or diagram label you want to remember…"
              className="mt-1 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Your note (optional)
            </span>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={2}
              placeholder="Why it matters, or what confused you…"
              className="mt-1 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            {saving ? "Saving…" : noteId ? "Update notes" : "Save notes"}
          </button>
          {message ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{message}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
