"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleQuiz } from "@/components/ModuleQuiz";
import { ModuleQuizReview } from "@/components/ModuleQuizReview";
import { buildPersonalQuizSessionItems } from "@/lib/quiz-session";
import type { CourseQuizItem } from "@/types/course";
import type { QuizReviewStatsDto } from "@/types/quiz-review";

type LoadedPersonalItem = {
  id: string;
  item: CourseQuizItem;
  due_at?: string;
};

function formatDueShort(iso?: string): "now" | string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMin = Math.round((t - Date.now()) / 60000);
  if (diffMin <= 0) return "now";
  if (diffMin === 1) return "1 min";
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH === 1) return "1 hr";
  if (diffH < 48) return `${diffH} hr`;
  const diffD = Math.round(diffMin / (60 * 24));
  if (diffD === 1) return "1 day";
  return `${diffD} days`;
}

type NoteRow = {
  id: string;
  lesson_index: number;
  highlight_excerpt: string;
  note_body: string;
};

export function PersonalQuizSection({
  materialId,
  moduleId,
  blocked,
  hasNextModule,
  onAdvanceModule,
  onRunOpenChange,
  onPersonalQuizBankChanged,
  sectionClassName,
}: {
  materialId: string;
  moduleId: number;
  blocked: boolean;
  hasNextModule: boolean;
  onAdvanceModule?: () => void;
  onRunOpenChange?: (open: boolean) => void;
  /** Called after personal bank data is refreshed (e.g. parent updates badge counts). */
  onPersonalQuizBankChanged?: () => void;
  /** Overrides default outer section spacing when nested under practice tabs (avoids double dividers). */
  sectionClassName?: string;
}) {
  const [rows, setRows] = useState<LoadedPersonalItem[]>([]);
  const [reviewByItemId, setReviewByItemId] = useState<
    Record<string, QuizReviewStatsDto>
  >({});
  const [missedIds, setMissedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(
    () => new Set()
  );
  const [extraContext, setExtraContext] = useState("");
  const [generateBusy, setGenerateBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [buildOpen, setBuildOpen] = useState(true);
  const [bankOpen, setBankOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editHighlight, setEditHighlight] = useState("");
  const [editNoteBody, setEditNoteBody] = useState("");
  const [noteEditBusy, setNoteEditBusy] = useState(false);
  const [noteEditMessage, setNoteEditMessage] = useState<string | null>(null);

  useEffect(() => {
    onRunOpenChange?.(runOpen);
  }, [runOpen, onRunOpenChange]);

  useEffect(() => {
    if (blocked) setRunOpen(false);
  }, [blocked]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [itemsRes, revRes, missRes, notesRes] = await Promise.all([
        fetch(
          `/api/study-materials/${materialId}/personal-quiz-items?moduleId=${moduleId}`
        ),
        fetch(
          `/api/study-materials/${materialId}/personal-quiz-review?moduleId=${moduleId}`
        ),
        fetch(
          `/api/study-materials/${materialId}/personal-quiz-missed?moduleId=${moduleId}`
        ),
        fetch(
          `/api/study-materials/${materialId}/lesson-notes?moduleId=${moduleId}`
        ),
      ]);

      if (itemsRes.ok) {
        const j = await itemsRes.json();
        const list = (j.items ?? []) as {
          id: string;
          item: CourseQuizItem;
          due_at?: string;
        }[];
        setRows(
          list.map((x) => ({
            id: x.id,
            item: x.item,
            due_at: x.due_at,
          }))
        );
      } else {
        setRows([]);
      }

      if (revRes.ok) {
        const j = await revRes.json();
        setReviewByItemId(
          (j.byItemId ?? {}) as Record<string, QuizReviewStatsDto>
        );
      } else {
        setReviewByItemId({});
      }

      if (missRes.ok) {
        const j = await missRes.json();
        setMissedIds(
          Array.isArray(j.missedPersonalItemIds)
            ? j.missedPersonalItemIds
            : []
        );
      } else {
        setMissedIds([]);
      }

      if (notesRes.ok) {
        const j = await notesRes.json();
        setNotes((j.notes ?? []) as NoteRow[]);
      } else {
        setNotes([]);
      }
    } catch {
      setError("Could not load personal study data.");
    } finally {
      onPersonalQuizBankChanged?.();
    }
  }, [materialId, moduleId, onPersonalQuizBankChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reviewMapped = useMemo(() => {
    const out: Record<string, QuizReviewStatsDto> = {};
    rows.forEach((r, i) => {
      const st = reviewByItemId[r.id];
      if (st) out[String(i)] = st;
    });
    return out;
  }, [rows, reviewByItemId]);

  const missedIndices = useMemo(() => {
    return missedIds
      .map((id) => rows.findIndex((r) => r.id === id))
      .filter((i) => i >= 0);
  }, [missedIds, rows]);

  const dueIndices = useMemo(() => {
    const now = Date.now();
    return rows
      .map((r, i) => ({ i, t: r.due_at ? new Date(r.due_at).getTime() : NaN }))
      .filter(({ t }) => Number.isFinite(t) && t <= now)
      .map(({ i }) => i);
  }, [rows]);

  const priorityIndices = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const i of [...missedIndices, ...dueIndices]) {
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
    return out;
  }, [missedIndices, dueIndices]);

  const sessionItems = useMemo(
    () => buildPersonalQuizSessionItems(rows, priorityIndices, epoch),
    [rows, priorityIndices, epoch]
  );

  const quizList = useMemo(() => rows.map((r) => r.item), [rows]);

  function toggleNote(id: string) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    setGenerateBusy(true);
    setError(null);
    try {
      const noteIds = [...selectedNoteIds];
      const extra = extraContext.trim();
      if (noteIds.length === 0 && extra.length < 20) {
        setError("Select saved notes and/or paste at least ~20 characters.");
        setGenerateBusy(false);
        return;
      }

      const res = await fetch(
        `/api/study-materials/${materialId}/personal-quiz/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            moduleId,
            noteIds: noteIds.length > 0 ? noteIds : undefined,
            extraContext: extra.length > 0 ? extra : undefined,
            count: 6,
          }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Sign in to generate personal questions.");
        setGenerateBusy(false);
        return;
      }
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Generation failed.");
        setGenerateBusy(false);
        return;
      }
      setExtraContext("");
      await refresh();
    } catch {
      setError("Network error.");
    }
    setGenerateBusy(false);
  }

  async function removeItem(id: string) {
    await fetch(
      `/api/study-materials/${materialId}/personal-quiz-items/${id}`,
      { method: "DELETE" }
    );
    await refresh();
  }

  const disableActions = blocked || generateBusy || noteEditBusy;

  function beginEditNote(n: NoteRow) {
    setNoteEditMessage(null);
    setEditingNoteId(n.id);
    setEditHighlight(n.highlight_excerpt ?? "");
    setEditNoteBody(n.note_body ?? "");
  }

  function cancelEditNote() {
    setEditingNoteId(null);
    setNoteEditMessage(null);
  }

  async function saveEditedNote() {
    if (!editingNoteId) return;
    const h = editHighlight.trim();
    const b = editNoteBody.trim();
    setNoteEditBusy(true);
    setNoteEditMessage(null);
    try {
      if (!h && !b) {
        const res = await fetch(
          `/api/study-materials/${materialId}/lesson-notes?id=${encodeURIComponent(editingNoteId)}`,
          { method: "DELETE" }
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNoteEditMessage(
            typeof j.error === "string" ? j.error : "Could not delete note."
          );
          setNoteEditBusy(false);
          return;
        }
        setSelectedNoteIds((prev) => {
          const next = new Set(prev);
          next.delete(editingNoteId);
          return next;
        });
        cancelEditNote();
        await refresh();
        setNoteEditBusy(false);
        return;
      }

      const res = await fetch(
        `/api/study-materials/${materialId}/lesson-notes`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingNoteId,
            highlightExcerpt: h,
            noteBody: b,
          }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNoteEditMessage(
          typeof j.error === "string" ? j.error : "Could not save note."
        );
        setNoteEditBusy(false);
        return;
      }
      cancelEditNote();
      await refresh();
    } catch {
      setNoteEditMessage("Network error.");
    }
    setNoteEditBusy(false);
  }

  return (
    <section
      className={
        sectionClassName ??
        "mt-8 border-t border-dashed border-brand-border/70 pt-6 dark:border-brand-border/35"
      }
    >
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Focus quiz
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Private cards from your highlights — separate from the module quiz bank.
        Question review for these cards is only in this section (below).
      </p>

      {quizList.length > 0 ? (
        <div
          id="practice-focus-question-review"
          className="scroll-mt-28 mt-6 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/90 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          <div className="border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-700/80">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Question review · focus only
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Not listed under Module bank review — these are your generated
              cards only.
            </p>
          </div>
          <div className="px-2 pb-4 pt-3 sm:px-3">
            <ModuleQuizReview
              embedded
              showHeader={false}
              bankScopeHint="Focus questions only"
              quiz={quizList}
              reviewByIndex={reviewMapped}
              scrollAreaClassName="max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain"
              allUnattemptedHint="No attempts on these focus questions yet — start your focus quiz below to build history."
            />
          </div>
        </div>
      ) : null}

      <details
        className="mt-6 overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/35"
        open={buildOpen}
        onToggle={(e) => setBuildOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-zinc-900 outline-none marker:content-none dark:text-zinc-100 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            <span>Add cards from notes</span>
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Tap to collapse
            </span>
          </span>
        </summary>
        <div className="border-t border-zinc-200/80 px-4 pb-4 pt-3 dark:border-zinc-700/80">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Build from your notes
          </p>
          {notes.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              No saved notes for this module yet. On each lesson, use{" "}
              <span className="font-medium">Your notes &amp; highlights</span>,
              then come back here and tick the notes to quiz.
            </p>
          ) : (
            <ul className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
              {notes.map((n) => (
                <li key={n.id}>
                  <div className="rounded-lg border border-zinc-200/90 bg-white/90 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950/80">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedNoteIds.has(n.id)}
                        onChange={() => toggleNote(n.id)}
                        disabled={
                          noteEditBusy ||
                          blocked ||
                          (editingNoteId !== null && editingNoteId === n.id)
                        }
                        className="transition-none mt-1 shrink-0"
                        aria-label={`Include lesson ${n.lesson_index + 1} in generation`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            Lesson {n.lesson_index + 1}
                          </span>
                          {editingNoteId !== n.id ? (
                            <button
                              type="button"
                              disabled={
                                noteEditBusy ||
                                blocked ||
                                (editingNoteId !== null &&
                                  editingNoteId !== n.id)
                              }
                              onClick={() => beginEditNote(n)}
                              className="transition-none text-[11px] font-semibold text-brand hover:underline disabled:opacity-40 dark:text-brand-soft"
                            >
                              Edit
                            </button>
                          ) : null}
                        </div>
                        {editingNoteId === n.id ? (
                          <div className="mt-2 space-y-2">
                            <label className="block">
                              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                                Highlight / excerpt
                              </span>
                              <textarea
                                value={editHighlight}
                                onChange={(e) =>
                                  setEditHighlight(e.target.value)
                                }
                                rows={3}
                                disabled={noteEditBusy}
                                className="mt-1 w-full resize-y rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-brand disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                                Your note (optional)
                              </span>
                              <textarea
                                value={editNoteBody}
                                onChange={(e) => setEditNoteBody(e.target.value)}
                                rows={2}
                                disabled={noteEditBusy}
                                className="mt-1 w-full resize-y rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-brand disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                              />
                            </label>
                            {noteEditMessage ? (
                              <p className="text-xs text-red-600 dark:text-red-400">
                                {noteEditMessage}
                              </p>
                            ) : null}
                            <p className="text-[11px] leading-snug text-zinc-500">
                              Clear both fields and tap Save to remove this note
                              from the module.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={noteEditBusy}
                                onClick={() => void saveEditedNote()}
                                className="transition-none rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
                              >
                                {noteEditBusy ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={noteEditBusy}
                                onClick={cancelEditNote}
                                className="transition-none rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-0.5 space-y-1">
                            {n.highlight_excerpt ? (
                              <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                                {n.highlight_excerpt}
                              </p>
                            ) : null}
                            {n.note_body ? (
                              <p className="text-xs whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                                <span className="font-medium text-zinc-500">
                                  Note:{" "}
                                </span>
                                {n.note_body}
                              </p>
                            ) : null}
                            {!n.highlight_excerpt && !n.note_body ? (
                              <p className="text-zinc-500">(empty)</p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Extra focus text (optional)
            </span>
            <textarea
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              rows={3}
              disabled={disableActions}
              placeholder="Paste anything else you want quizzed — still private to you."
              className="mt-1 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <button
            type="button"
            disabled={disableActions}
            onClick={() => void generate()}
            className="transition-none mt-3 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-md shadow-red-600/20 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
          >
            {generateBusy ? "Generating…" : "Generate focus questions (AI)"}
          </button>
          {blocked ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Finish or exit the shared module quiz in this section before running your
              focus set.
            </p>
          ) : null}
        </div>
      </details>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {rows.length > 0 ? (
        <details
          className="mt-4 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/90 dark:border-zinc-800 dark:bg-zinc-950/50"
          open={bankOpen}
          onToggle={(e) => setBankOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-zinc-900 outline-none marker:content-none dark:text-zinc-100 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-3">
              <span>Saved cards ({rows.length})</span>
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                Expand to edit &amp; remove
              </span>
            </span>
          </summary>
          <div className="border-t border-zinc-200/80 px-3 pb-3 pt-2 dark:border-zinc-700/80">
            <ul className="max-h-52 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200/90 bg-zinc-50/80 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-zinc-800 dark:text-zinc-200">
                      {r.item.question}
                    </span>
                    {(() => {
                      const d = formatDueShort(r.due_at);
                      if (!d) return null;
                      return (
                        <span className="mt-1 block text-[10px] font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
                          {d === "now" ? (
                            <span className="uppercase">Due now</span>
                          ) : (
                            <>
                              <span className="uppercase">Next review</span>
                              <span className="normal-case tabular-nums">
                                {" "}
                                · in {d}
                              </span>
                            </>
                          )}
                        </span>
                      );
                    })()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeItem(r.id)}
                    className="transition-none shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      <div className="mt-8">
        {!runOpen ? (
          <button
            type="button"
            disabled={quizList.length === 0 || blocked}
            onClick={() => {
              setEpoch((e) => e + 1);
              setRunOpen(true);
            }}
            title={
              quizList.length === 0
                ? "Generate focus questions first"
                : undefined
            }
            className="transition-none inline-flex items-center justify-center rounded-full border border-brand-border bg-brand-blush/90 px-8 py-3.5 text-sm font-semibold text-brand-ink shadow-sm hover:bg-brand-blush disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-border/50 dark:bg-[#1e1616]/90 dark:text-brand-soft dark:hover:bg-[#2a2020]"
          >
            Start my focus quiz
          </button>
        ) : (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Focus quiz run
              </p>
              <button
                type="button"
                onClick={() => setRunOpen(false)}
                className="transition-none text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                ← Back
              </button>
            </div>
            <ModuleQuiz
              key={`personal-${moduleId}-${epoch}`}
              materialId={materialId}
              moduleId={moduleId}
              items={sessionItems}
              shuffleEpoch={epoch}
              hasNextModule={hasNextModule}
              onCompleteQuiz={async (choice) => {
                setRunOpen(false);
                setEpoch((e) => e + 1);
                await refresh();
                if (choice === "next_module") {
                  onAdvanceModule?.();
                }
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
