"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LESSON_HAS_NOTE_QUERY_EVENT,
  LESSON_HIGHLIGHT_REMOVE_FROM_NOTES_EVENT,
  LESSON_HIGHLIGHT_RESTORE_EVENT,
  LESSON_QUOTE_EVENT,
  type LessonHasNoteQueryDetail,
  type LessonHighlightColor,
  type LessonHighlightRemoveFromNotesDetail,
  type LessonHighlightRestoreDetail,
  type LessonHighlightAnchor,
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

const HIGHLIGHT_LABEL_RE =
  /^\[(Pink|Yellow|Blue|Green|Purple) highlight(?:\|([a-z0-9]+:\d+)\|(\d+):(\d+))?\]\s+([\s\S]*)$/i;

function parseHighlightLabel(part: string): {
  color?: LessonHighlightColor;
  anchor?: LessonHighlightAnchor;
  text: string;
} | null {
  const m = part.match(HIGHLIGHT_LABEL_RE);
  if (!m) return null;
  const color = m[1].toLowerCase() as LessonHighlightColor;
  const text = m[5].trim();
  if (!m[2] || m[3] === undefined || m[4] === undefined) {
    return { color, text };
  }
  const start = Number(m[3]);
  const end = Number(m[4]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { color, text };
  }
  return {
    color,
    text,
    anchor: { blockPath: m[2], start, end },
  };
}

function formatHighlightEntry(
  text: string,
  color?: LessonHighlightColor,
  anchor?: LessonHighlightAnchor
): string {
  if (!color) return text.trim();
  const label = `${color[0].toUpperCase()}${color.slice(1)}`;
  const anchorSuffix =
    anchor &&
    Number.isFinite(anchor.start) &&
    Number.isFinite(anchor.end)
      ? `|${anchor.blockPath}|${anchor.start}:${anchor.end}`
      : "";
  return `[${label} highlight${anchorSuffix}] ${text.trim()}`;
}

function dispatchHighlightRestore(detail: LessonHighlightRestoreDetail) {
  window.dispatchEvent(
    new CustomEvent<LessonHighlightRestoreDetail>(
      LESSON_HIGHLIGHT_RESTORE_EVENT,
      { detail }
    )
  );
}

type NoteRow = {
  id: string;
  lesson_index: number;
  highlight_excerpt: string;
  note_body: string;
  updated_at: string;
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

function parseHighlightEntries(raw: string): Array<{
  key: string;
  text: string;
  color?: LessonHighlightColor;
  anchor?: LessonHighlightAnchor;
}> {
  return splitEntries(raw).map((part, index) => {
    const parsed = parseHighlightLabel(part);
    if (parsed?.color) {
      const anchorKey = parsed.anchor
        ? `${parsed.anchor.blockPath}:${parsed.anchor.start}:${parsed.anchor.end}`
        : "legacy";
      return {
        key: `${index}-${parsed.color}-${anchorKey}`,
        text: parsed.text,
        color: parsed.color,
        anchor: parsed.anchor,
      };
    }
    return { key: `${index}-plain`, text: part };
  });
}

function anchorsEqual(
  a?: LessonHighlightAnchor,
  b?: LessonHighlightAnchor
): boolean {
  if (!a || !b) return false;
  return (
    a.blockPath === b.blockPath && a.start === b.start && a.end === b.end
  );
}

function removeHighlightEntry(
  raw: string,
  textToRemove: string,
  anchorToRemove?: LessonHighlightAnchor
): string {
  const normalized = textToRemove.replace(/\s+/g, " ").trim();
  if (!normalized) return raw;
  const parts = splitEntries(raw);
  const parsed = parts.map((part) => parseHighlightLabel(part));
  if (anchorToRemove) {
    return parts
      .filter((_, i) => !anchorsEqual(parsed[i]?.anchor, anchorToRemove))
      .join(ENTRY_JOIN);
  }
  const labels = parsed.map((p) =>
    p ? p.text.replace(/\s+/g, " ").trim() : null
  );
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
  textToFind: string,
  anchorToFind?: LessonHighlightAnchor
):
  | {
      text: string;
      color: LessonHighlightColor;
      anchor?: LessonHighlightAnchor;
    }
  | null {
  const normalized = textToFind.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const parsed = parseHighlightEntries(raw);
  if (anchorToFind) {
    const byAnchor = parsed.find(
      (e) => Boolean(e.color) && anchorsEqual(e.anchor, anchorToFind)
    );
    if (byAnchor && byAnchor.color) {
      return {
        text: byAnchor.text,
        color: byAnchor.color,
        anchor: byAnchor.anchor,
      };
    }
  }
  const exact = parsed.find(
    (e) =>
      Boolean(e.color) && e.text.replace(/\s+/g, " ").trim() === normalized
  );
  if (exact && exact.color) {
    return {
      text: exact.text,
      color: exact.color,
      anchor: exact.anchor,
    };
  }
  const partial = parsed.find(
    (e) =>
      Boolean(e.color) &&
      normalized.length > 2 &&
      e.text.replace(/\s+/g, " ").trim().includes(normalized)
  );
  if (partial && partial.color) {
    return {
      text: partial.text,
      color: partial.color,
      anchor: partial.anchor,
    };
  }
  return null;
}

function upsertHighlightEntry(
  raw: string,
  entry: string,
  text: string,
  anchor?: LessonHighlightAnchor
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const parts = splitEntries(raw);
  let replaced = false;
  const updated = parts.map((part) => {
    const parsed = parseHighlightLabel(part);
    if (!parsed?.color) return part;
    if (anchor && anchorsEqual(parsed.anchor, anchor)) {
      replaced = true;
      return entry;
    }
    if (parsed.text.replace(/\s+/g, " ").trim() === normalized) {
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

  /**
   * Low-level persistence used by both the Save button and the auto-save
   * triggered by chip removals. Accepts explicit values so callers can
   * persist a *just-mutated* state without waiting for React to flush.
   *
   * Auto-save callers pass `silent=true` so we don't flash transient
   * "Saved" messages on every chip click.
   *
   * When BOTH `h` and `n` end up empty AND we have an existing `noteId`,
   * we DELETE the row outright instead of POSTing an empty note — that's
   * how removing the last chip becomes "removed permanently."
   */
  const persistNote = useCallback(
    async (h: string, n: string, silent = false) => {
      setSaving(true);
      if (!silent) setMessage(null);
      try {
        const trimmedH = h.trim();
        const trimmedN = n.trim();

        if (trimmedH.length === 0 && trimmedN.length === 0) {
          if (noteId) {
            const delRes = await fetch(
              `/api/study-materials/${materialId}/lesson-notes?id=${encodeURIComponent(noteId)}`,
              { method: "DELETE" }
            );
            if (delRes.ok) {
              setNoteId(null);
              if (!silent) setMessage("Removed.");
            } else if (delRes.status === 401) {
              setMessage("Sign in to save private notes for this lesson.");
            } else if (!silent) {
              setMessage("Could not remove this note.");
            }
          } else if (!silent) {
            setMessage("Add a highlight or a note before saving.");
          }
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
        if (!silent) {
          setMessage("Saved — you can quiz this from the practice room.");
          await load();
        }
      } catch {
        setMessage("Network error.");
      }
      setSaving(false);
    },
    [load, materialId, moduleId, lessonIndex, noteId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const highlightEntries = useMemo(
    () => parseHighlightEntries(highlight),
    [highlight]
  );

  // Re-apply saved highlights to the lesson text after notes load (or refresh).
  useEffect(() => {
    if (loading) return;
    const labeled = highlightEntries.filter(
      (e): e is typeof e & { color: LessonHighlightColor } => Boolean(e.color)
    );
    if (labeled.length === 0) return;
    const timer = window.setTimeout(() => {
      dispatchHighlightRestore({
        lessonIndex,
        entries: labeled.map((e) => ({
          text: e.text,
          color: e.color,
          anchor: e.anchor,
        })),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading, highlightEntries, lessonIndex]);

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
          t,
          d.anchor
        );
        const chipNormalized = containingChip
          ? containingChip.text.replace(/\s+/g, " ").trim()
          : "";
        const tNormalized = t.replace(/\s+/g, " ").trim();
        setHighlight((prev) =>
          removeHighlightEntry(prev, t, d.anchor ?? containingChip?.anchor)
        );
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
            anchor: containingChip.anchor,
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
      const entry = formatHighlightEntry(t, d.color, d.anchor);

      setHighlight((prev) => {
        const p = prev.trim();
        const next = !p
          ? entry
          : d.color
            ? upsertHighlightEntry(p, entry, t, d.anchor)
            : p.includes(t)
              ? p
              : `${p}${ENTRY_JOIN}${entry}`;
        void persistNote(next, noteBodyRef.current, true);
        return next;
      });
      setMessage(
        d.color
          ? `Added ${d.color} highlight — saved to your notes.`
          : "Added selection — saved to your notes."
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
  }, [lessonIndex, persistNote]);

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
    // Persist the restored state immediately so undo also survives a reload.
    void persistNote(undoState.highlight, undoState.noteBody, true);
  }, [undoState, persistNote]);

  const removeChip = useCallback(
    (entry: {
      text: string;
      color?: LessonHighlightColor;
      anchor?: LessonHighlightAnchor;
    }) => {
      const snapshot = {
        highlight: highlightRef.current,
        noteBody: noteBodyRef.current,
      };
      const nextHighlight = removeHighlightEntry(
        highlightRef.current,
        entry.text,
        entry.anchor
      );
      setHighlight(nextHighlight);
      dispatchHighlightRemoveFromNotes({
        lessonIndex,
        text: entry.text,
        color: entry.color,
        anchor: entry.anchor,
      });
      setMessage("Removed.");
      setUndoState({
        ...snapshot,
        label: "Undo remove highlight",
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      });
      // Persist immediately so removal survives a refresh. If both
      // highlight and note end up empty, persistNote deletes the row.
      void persistNote(nextHighlight, noteBodyRef.current, true);
    },
    [lessonIndex, persistNote]
  );

  const clearAllHighlights = useCallback(() => {
    const snapshot = {
      highlight: highlightRef.current,
      noteBody: noteBodyRef.current,
    };
    const parsed = parseHighlightEntries(highlightRef.current);
    setHighlight("");
    for (const entry of parsed) {
      if (!entry.color) continue;
      dispatchHighlightRemoveFromNotes({
        lessonIndex,
        text: entry.text,
        color: entry.color,
        anchor: entry.anchor,
      });
    }
    setMessage("Cleared.");
    setUndoState({
      ...snapshot,
      label: "Undo clear",
      expiresAt: Date.now() + UNDO_WINDOW_MS,
    });
    void persistNote("", noteBodyRef.current, true);
  }, [lessonIndex, persistNote]);

  const save = useCallback(async () => {
    await persistNote(highlight, noteBody, false);
  }, [highlight, noteBody, persistNote]);

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
        , drag to highlight any sentence and release to add it here. Save your
        optional note below, then build focus questions on the practice tab.
      </p>
      {loading ? (
        <p className="mt-3 text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Highlights
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
                        removeChip({
                          text: entry.text,
                          color: entry.color,
                          anchor: entry.anchor,
                        })
                      }
                      aria-label="Remove highlight"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-white/50 px-3 py-2.5 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-400">
                Drag over lesson text to highlight — your selections appear
                here and stay marked when you return.
              </p>
            )}
          </div>
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
