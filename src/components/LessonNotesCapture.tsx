"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LESSON_HAS_NOTE_QUERY_EVENT,
  LESSON_HIGHLIGHT_REMOVE_FROM_NOTES_EVENT,
  LESSON_QUOTE_EVENT,
  type LessonHasNoteQueryDetail,
  type LessonHighlightColor,
  type LessonHighlightRemoveFromNotesDetail,
  type LessonQuoteDetail,
} from "@/components/LessonQuoteCaptureRegion";

const UNDO_WINDOW_MS = 8000;

function dispatchHighlightRemoveFromNotes(
  detail: LessonHighlightRemoveFromNotesDetail
) {
  window.dispatchEvent(
    new CustomEvent<LessonHighlightRemoveFromNotesDetail>(
      LESSON_HIGHLIGHT_REMOVE_FROM_NOTES_EVENT,
      { detail }
    )
  );
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

type NoteRow = {
  id: string;
  lesson_index: number;
  highlight_excerpt: string;
  note_body: string;
  updated_at: string;
};

const HIGHLIGHT_COLORS: Record<
  LessonHighlightColor,
  { label: string; className: string }
> = {
  pink: { label: "Pink", className: "bg-pink-100 text-pink-950" },
  yellow: { label: "Yellow", className: "bg-amber-100 text-amber-950" },
  blue: { label: "Blue", className: "bg-blue-100 text-blue-950" },
  green: { label: "Green", className: "bg-green-100 text-green-950" },
  purple: { label: "Purple", className: "bg-violet-100 text-violet-950" },
};

// Entries in the textarea are separated by a blank line. The old `---`
// fence is still accepted on split so existing saved notes parse cleanly,
// but new writes use a plain blank line.
const ENTRY_SPLIT_RE = /\n\s*(?:---\s*\n|\n)/g;
const ENTRY_JOIN = "\n\n";

function splitEntries(raw: string): string[] {
  return raw
    .split(ENTRY_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseHighlightEntries(raw: string): Array<{
  key: string;
  text: string;
  color?: LessonHighlightColor;
}> {
  return splitEntries(raw).map((part, index) => {
    const colorMatch = part.match(
      /^\[(Pink|Yellow|Blue|Green|Purple) highlight\]\s+([\s\S]*)$/i
    );
    if (colorMatch) {
      const color = colorMatch[1].toLowerCase() as LessonHighlightColor;
      return { key: `${index}-${color}`, text: colorMatch[2].trim(), color };
    }
    return { key: `${index}-plain`, text: part };
  });
}

function removeHighlightEntry(raw: string, textToRemove: string): string {
  const normalized = textToRemove.replace(/\s+/g, " ").trim();
  if (!normalized) return raw;
  const parts = splitEntries(raw);
  // Prefer exact match: if any labeled chip's text equals the target, only
  // strip exact matches and leave any substring-containing chips alone.
  // Otherwise fall back to "contains" so a single line removed on the page
  // takes its multi-line parent chip with it.
  const labels = parts.map((part) => {
    const m = part.match(
      /^\[(Pink|Yellow|Blue|Green|Purple) highlight\]\s+([\s\S]*)$/i
    );
    if (!m) return null;
    return m[2].replace(/\s+/g, " ").trim();
  });
  const hasExact = labels.some((l) => l !== null && l === normalized);
  return parts
    .filter((_, i) => {
      const label = labels[i];
      if (label === null) return true;
      if (hasExact) return label !== normalized;
      return !(normalized.length > 2 && label.includes(normalized));
    })
    .join(ENTRY_JOIN);
}

function findContainingHighlightChip(
  raw: string,
  textToFind: string
):
  | {
      text: string;
      color: LessonHighlightColor;
    }
  | null {
  const normalized = textToFind.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const parsed = parseHighlightEntries(raw);
  const exact = parsed.find(
    (e) =>
      Boolean(e.color) && e.text.replace(/\s+/g, " ").trim() === normalized
  );
  if (exact && exact.color) return { text: exact.text, color: exact.color };
  const partial = parsed.find(
    (e) =>
      Boolean(e.color) &&
      normalized.length > 2 &&
      e.text.replace(/\s+/g, " ").trim().includes(normalized)
  );
  if (partial && partial.color)
    return { text: partial.text, color: partial.color };
  return null;
}

function upsertHighlightEntry(raw: string, entry: string, text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const parts = splitEntries(raw);
  // Replace in place when the text already exists (preserves chip order on
  // recolor). Otherwise append.
  let replaced = false;
  const updated = parts.map((part) => {
    const colorMatch = part.match(
      /^\[(Pink|Yellow|Blue|Green|Purple) highlight\]\s+([\s\S]*)$/i
    );
    if (!colorMatch) return part;
    if (colorMatch[2].replace(/\s+/g, " ").trim() === normalized) {
      replaced = true;
      return entry;
    }
    return part;
  });
  if (!replaced) updated.push(entry);
  return updated.join(ENTRY_JOIN);
}

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
  const [undoState, setUndoState] = useState<
    | {
        highlight: string;
        noteBody: string;
        label: string;
        expiresAt: number;
      }
    | null
  >(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const noteBodyRef = useRef(noteBody);
  const highlightRef = useRef(highlight);

  useEffect(() => {
    noteBodyRef.current = noteBody;
  }, [noteBody]);

  useEffect(() => {
    highlightRef.current = highlight;
  }, [highlight]);

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

  useEffect(() => {
    const onQuote = (ev: Event) => {
      const ce = ev as CustomEvent<LessonQuoteDetail>;
      const d = ce.detail;
      if (!d || d.lessonIndex !== lessonIndex) return;
      const t = d.text.trim();
      if (t.length < 2) return;
      if (
        d.action === "remove-highlight" ||
        d.action === "remove-highlight-and-note"
      ) {
        const snapshot = {
          highlight: highlightRef.current,
          noteBody: noteBodyRef.current,
        };
        // Find which chip contains the dispatched text. For multi-line
        // highlights, the page only knows about one of the sibling marks; the
        // chip's full text is needed to broadcast a cleanup for the remaining
        // siblings.
        const containingChip = findContainingHighlightChip(
          highlightRef.current,
          t
        );
        const chipNormalized = containingChip
          ? containingChip.text.replace(/\s+/g, " ").trim()
          : "";
        const tNormalized = t.replace(/\s+/g, " ").trim();
        setHighlight((prev) => removeHighlightEntry(prev, t));
        if (
          containingChip &&
          chipNormalized !== tNormalized
        ) {
          console.log(
            "[notes] multi-line chip remove — clearing sibling marks on page",
            { dispatchedText: t, chipText: containingChip.text }
          );
          dispatchHighlightRemoveFromNotes({
            lessonIndex,
            text: containingChip.text,
            color: containingChip.color,
          });
        }
        if (d.action === "remove-highlight-and-note") {
          console.log("[notes] removing attached note alongside highlight", { text: t });
          setNoteBody("");
          setMessage(
            "Removed highlight and note — save to keep this change."
          );
          setUndoState({
            ...snapshot,
            label: "Undo remove highlight & note",
            expiresAt: Date.now() + UNDO_WINDOW_MS,
          });
        } else {
          setMessage(
            "Removed highlight from notes — save to keep this change."
          );
          setUndoState({
            ...snapshot,
            label: "Undo remove highlight",
            expiresAt: Date.now() + UNDO_WINDOW_MS,
          });
        }
        return;
      }
      const label = d.color
        ? `[${d.color[0].toUpperCase()}${d.color.slice(1)} highlight]`
        : "";
      const entry = label ? `${label} ${t}` : t;

      setHighlight((prev) => {
        const p = prev.trim();
        if (!p) return entry;
        if (d.color) return upsertHighlightEntry(p, entry, t);
        if (p.includes(t)) return p;
        return `${p}${ENTRY_JOIN}${entry}`;
      });
      setMessage(
        d.color
          ? `Added ${d.color} highlight — edit or save when ready.`
          : "Added selection to highlight — edit or save when ready."
      );
      // Intentionally no scrollIntoView — adding a highlight should not
      // bounce the page down to the notes panel; the user is reading the
      // lesson and the chip will be there when they look.
    };

    const onHasNoteQuery = (ev: Event) => {
      const ce = ev as CustomEvent<LessonHasNoteQueryDetail>;
      if (!ce.detail || ce.detail.lessonIndex !== lessonIndex) return;
      if (noteBodyRef.current.trim().length > 0) {
        ce.detail.hasNote = true;
      }
    };

    window.addEventListener(LESSON_QUOTE_EVENT, onQuote);
    window.addEventListener(LESSON_HAS_NOTE_QUERY_EVENT, onHasNoteQuery);
    return () => {
      window.removeEventListener(LESSON_QUOTE_EVENT, onQuote);
      window.removeEventListener(LESSON_HAS_NOTE_QUERY_EVENT, onHasNoteQuery);
    };
  }, [lessonIndex]);

  useEffect(() => {
    if (!undoState) return;
    const remaining = undoState.expiresAt - Date.now();
    if (remaining <= 0) {
      setUndoState(null);
      return;
    }
    const t = window.setTimeout(() => {
      setUndoState((prev) => (prev === undoState ? null : prev));
    }, remaining);
    return () => window.clearTimeout(t);
  }, [undoState]);

  const handleUndo = useCallback(() => {
    if (!undoState) return;
    console.log("[notes] undo remove", undoState.label);
    setHighlight(undoState.highlight);
    setNoteBody(undoState.noteBody);
    // Re-applying highlights to the DOM would require re-running the original
    // selection ranges. The text remains in the lesson body so the user can
    // re-highlight if needed; for now we restore the saved excerpt + note.
    setMessage("Restored — save to keep your previous notes.");
    setUndoState(null);
  }, [undoState]);

  const removeChip = useCallback(
    (entry: { text: string; color?: LessonHighlightColor }) => {
      const snapshot = {
        highlight: highlightRef.current,
        noteBody: noteBodyRef.current,
      };
      console.log("[notes] removing chip", entry);
      setHighlight((prev) => removeHighlightEntry(prev, entry.text));
      dispatchHighlightRemoveFromNotes({
        lessonIndex,
        text: entry.text,
        color: entry.color,
      });
      setMessage("Removed highlight from notes and page — save to keep this.");
      setUndoState({
        ...snapshot,
        label: "Undo remove highlight",
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      });
    },
    [lessonIndex]
  );

  const clearAllHighlights = useCallback(() => {
    const snapshot = {
      highlight: highlightRef.current,
      noteBody: noteBodyRef.current,
    };
    const parsed = parseHighlightEntries(highlightRef.current);
    console.log("[notes] clearing all highlights", parsed.length);
    setHighlight("");
    for (const entry of parsed) {
      if (!entry.color) continue;
      dispatchHighlightRemoveFromNotes({
        lessonIndex,
        text: entry.text,
        color: entry.color,
      });
    }
    setMessage("Cleared all highlights — save to keep this.");
    setUndoState({
      ...snapshot,
      label: "Undo clear",
      expiresAt: Date.now() + UNDO_WINDOW_MS,
    });
  }, [lessonIndex]);

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

  const highlightEntries = useMemo(
    () => parseHighlightEntries(highlight),
    [highlight]
  );

  // Track labeled chips that disappeared (e.g. the user edited the highlight
  // textarea directly). After a short debounce — long enough to ignore
  // mid-typing flicker — sync the removal to the page so the on-page <mark>
  // also disappears.
  const lastSyncedLabeledRef = useRef<
    Array<{ color: LessonHighlightColor; text: string }>
  >([]);

  useEffect(() => {
    const labeled = highlightEntries
      .filter((e): e is typeof e & { color: LessonHighlightColor } => Boolean(e.color))
      .map((e) => ({ color: e.color, text: normalizeText(e.text) }));
    const previous = lastSyncedLabeledRef.current;
    const timer = window.setTimeout(() => {
      const current = highlightEntries
        .filter((e): e is typeof e & { color: LessonHighlightColor } => Boolean(e.color))
        .map((e) => ({ color: e.color, text: normalizeText(e.text) }));
      const vanished = previous.filter(
        (prev) =>
          !current.some(
            (cur) => cur.color === prev.color && cur.text === prev.text
          )
      );
      for (const v of vanished) {
        console.log("[notes] textarea-edit removed chip; syncing to page", v);
        dispatchHighlightRemoveFromNotes({
          lessonIndex,
          text: v.text,
          color: v.color,
        });
      }
      lastSyncedLabeledRef.current = current;
    }, 900);
    // Keep a quick mirror so re-mounting doesn't think every chip just vanished.
    if (lastSyncedLabeledRef.current.length === 0 && labeled.length > 0) {
      lastSyncedLabeledRef.current = labeled;
    }
    return () => window.clearTimeout(timer);
  }, [highlightEntries, lessonIndex]);

  return (
    <div
      ref={panelRef}
      className="mt-8 rounded-2xl border border-zinc-200/90 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Your notes &amp; highlights
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Private to your account — in{" "}
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {lessonTitle}
        </span>
        , drag to highlight any sentence and release to add it to the excerpt
        below (or paste manually). Save, then build focus questions on the
        practice tab.
      </p>
      {loading ? (
        <p className="mt-3 text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Highlight / excerpt
            </span>
            {highlightEntries.length > 0 ? (
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-zinc-200 bg-white/70 p-2 pr-1 dark:border-zinc-700 dark:bg-zinc-950/40">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    {highlightEntries.length} highlight
                    {highlightEntries.length === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    onClick={clearAllHighlights}
                    className="text-[10px] font-semibold text-zinc-500 hover:text-red-600 dark:hover:text-red-300"
                  >
                    Clear all
                  </button>
                </div>
                {highlightEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-start gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    <div className="flex-1">
                      {entry.color ? (
                        <span
                          className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${HIGHLIGHT_COLORS[entry.color].className}`}
                        >
                          {HIGHLIGHT_COLORS[entry.color].label}
                        </span>
                      ) : null}
                      <span>{entry.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        removeChip({ text: entry.text, color: entry.color })
                      }
                      aria-label="Remove highlight"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
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
          {message || undoState ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              {message ? <span>{message}</span> : null}
              {undoState ? (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  {undoState.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
