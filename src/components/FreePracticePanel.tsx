"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ReviewPickerList } from "@/components/ReviewPickerList";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { deleteReviewMaterials } from "@/lib/review-delete-materials";
import {
  allPickerLeafIds,
  deleteItemsForSelection,
  groupReviewPickerRows,
  pickerSelectionToSessionParams,
  practiceScopeToPickerSource,
  selectedGroupCount,
  visibleDueForLeaves,
} from "@/lib/review-picker";
import type { SrsDueNoteChild } from "@/lib/srs-due";

type ScopeMaterial = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  moduleQuestions: number;
  personalQuestions: number;
  total: number;
  notes?: SrsDueNoteChild[];
};

type ScopeResponse = {
  materials: ScopeMaterial[];
  totals: { module: number; personal: number; total: number };
};

export type FreePracticeStart = {
  materialIds: string[];
  noteIds?: string[];
};

/**
 * Course chooser for free practice (cram). Lists every course with its total
 * practiceable questions so the learner can pick which courses to drill,
 * ignoring the spaced-repetition schedule.
 */
export function FreePracticePanel({
  onStart,
  onCancel,
  onMaterialsChanged,
}: {
  /** Empty materialIds = practice everything. */
  onStart: (payload: FreePracticeStart) => void;
  onCancel: () => void;
  /** Fired after a successful delete so the parent can refresh Deleted. */
  onMaterialsChanged?: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<ScopeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/srs/practice-scope");
        if (!res.ok) throw new Error(`practice-scope ${res.status}`);
        const json = (await res.json()) as ScopeResponse;
        if (cancelled) return;
        setData(json);
        setSelected(
          new Set(
            allPickerLeafIds(
              groupReviewPickerRows(json.materials.map(practiceScopeToPickerSource))
            )
          )
        );
      } catch (e) {
        if (!cancelled) setError("Could not load your courses. Try again.");
        console.warn("[free-practice scope]", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(
    () =>
      groupReviewPickerRows(
        (data?.materials ?? []).map(practiceScopeToPickerSource)
      ),
    [data]
  );
  const allLeafIds = useMemo(() => allPickerLeafIds(groups), [groups]);
  const selectedSession = useMemo(
    () => pickerSelectionToSessionParams(groups, selected),
    [groups, selected]
  );
  const selectedQuestionTotal = useMemo(
    () => visibleDueForLeaves(groups, selected, "both"),
    [groups, selected]
  );
  const selectedCourseCount = useMemo(
    () => selectedGroupCount(groups, selected),
    [groups, selected]
  );
  const allSelected =
    allLeafIds.length > 0 && allLeafIds.every((id) => selected.has(id));

  const toggleLeaf = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (group: (typeof groups)[number]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = group.leafIds.every((id) => next.has(id));
      for (const id of group.leafIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const confirmDeleteSelected = async () => {
    const items = deleteItemsForSelection(groups, selected);
    if (items.length === 0) {
      setPendingDelete(false);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteReviewMaterials(items);
      if (result.failed > 0) {
        setDeleteError(t.review.deleteSelectedError);
      }
      if (result.ok > 0) {
        onMaterialsChanged?.();
      }
      setPendingDelete(false);
      setLoading(true);
      const res = await fetch("/api/srs/practice-scope");
      if (res.ok) {
        const json = (await res.json()) as ScopeResponse;
        setData(json);
        setSelected(
          new Set(
            allPickerLeafIds(
              groupReviewPickerRows(json.materials.map(practiceScopeToPickerSource))
            )
          )
        );
      }
    } catch {
      setDeleteError(t.review.deleteSelectedError);
    } finally {
      setDeleting(false);
      setLoading(false);
    }
  };

  return (
    <section className="space-y-5">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Back to Review dashboard
      </button>

      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          Free practice
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Choose what to practice
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Free practice ignores the review schedule and re-serves questions
          you&apos;ve already tried — quiz questions you&apos;ve answered plus
          your saved focus cards — so you drill familiar material instead of
          brand-new questions. Pick a whole course or a specific note.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Loading your courses…
        </p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          Nothing to practice yet. Once you&apos;ve answered some quiz
          questions or saved focus cards, they&apos;ll show up here to drill.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {groups.length} course{groups.length === 1 ? "" : "s"} ·{" "}
              {data?.totals.total ?? 0} questions total
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(allLeafIds))
                }
                className="text-xs font-medium text-brand hover:text-brand-hover dark:text-brand-soft"
              >
                {allSelected ? t.review.clearAll : t.review.selectAll}
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || deleting}
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(true);
                }}
                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
              >
                {t.review.deleteSelected}
              </button>
            </div>
          </div>

          {deleteError ? (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {deleteError}
            </p>
          ) : null}

          <ReviewPickerList
            groups={groups}
            selectedIds={selected}
            onToggleLeaf={toggleLeaf}
            onToggleGroup={toggleGroup}
            showModulePills
            maxHeightClass="max-h-[22rem] overflow-y-auto"
          />

          <div className="sticky bottom-4 z-10 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => onStart(selectedSession)}
              disabled={selectedSession.materialIds.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Start free practice
              <span className="opacity-90">
                ({selectedQuestionTotal} question
                {selectedQuestionTotal === 1 ? "" : "s"} from{" "}
                {selectedCourseCount} course
                {selectedCourseCount === 1 ? "" : "s"})
              </span>
            </button>
            <button
              type="button"
              onClick={() => onStart({ materialIds: [] })}
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-3.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Practice everything
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete}
        title={
          selectedCourseCount === 1
            ? t.review.deleteSelectedTitleOne
            : tf(t.review.deleteSelectedTitle, { count: selectedCourseCount })
        }
        confirmLabel={t.review.deleteSelected}
        confirmBusy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDelete(false);
        }}
        onConfirm={() => void confirmDeleteSelected()}
      >
        {t.review.deleteSelectedWarning}
      </ConfirmDialog>
    </section>
  );
}
