"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FreePracticePanel } from "@/components/FreePracticePanel";
import { ReviewDeletedMaterials } from "@/components/ReviewDeletedMaterials";
import { ReviewPickerList } from "@/components/ReviewPickerList";
import { ReviewQuestionsPreview } from "@/components/ReviewQuestionsPreview";
import { ReviewSettingsPanel } from "@/components/ReviewSettingsPanel";
import { SrsReviewLauncher } from "@/components/SrsReviewLauncher";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { deleteReviewMaterials } from "@/lib/review-delete-materials";
import {
  allPickerLeafIds,
  deleteItemsForSelection,
  groupReviewPickerRows,
  pickerSelectionToSessionParams,
  selectedGroupCount,
  visibleDueForLeaves,
} from "@/lib/review-picker";
import { useSrsDueCounts } from "@/lib/srs-due";
import { REVIEW_DUE_COUNTS_CLIENT_TIMEOUT_MS } from "@/lib/widget-json-fetch";

/**
 * Global Review dashboard.
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  You have N cards due today                         │
 *   │  ┌─────────────────────────┐                        │
 *   │  │  Review All  (primary)  │                        │
 *   │  └─────────────────────────┘                        │
 *   │  Or choose specific courses and note sections       │
 *   │   [✓] Biology 101    Mod 8 / Focus 3 / Total 11     │
 *   │   [ ] Anatomy        Mod 4 / Focus 12 / Total 16    │
 *   │   ...                                                │
 *   │  Include:  ● Both  ○ Module only  ○ Focus only      │
 *   │  ┌─────────────────────────────────────────┐        │
 *   │  │ Start Review (23 cards from 2 courses)  │        │
 *   │  └─────────────────────────────────────────┘        │
 *   └─────────────────────────────────────────────────────┘
 */

type ReviewKind = "both" | "module" | "personal";

export function ReviewDashboardClient() {
  const t = useT();
  const { counts, refresh } = useSrsDueCounts(undefined, {
    enabled: true,
    timeoutMs: REVIEW_DUE_COUNTS_CLIENT_TIMEOUT_MS,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ReviewKind>("both");
  const [choosingPractice, setChoosingPractice] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletedRefreshKey, setDeletedRefreshKey] = useState(0);
  // When true, we are inside a launched session and hide the picker.
  const [sessionMode, setSessionMode] = useState<
    null | {
      materialIds: string[];
      noteIds?: string[];
      scope: ReviewKind;
      kindBefore: ReviewKind;
      cram?: boolean;
    }
  >(null);

  const materials = counts?.byMaterial ?? [];
  const groups = useMemo(() => groupReviewPickerRows(materials), [materials]);
  const allLeafIds = useMemo(() => allPickerLeafIds(groups), [groups]);

  // Preselect everything once counts arrive (matches the "all" default
  // from the spec; later we'll honor user_srs_prefs.default_dashboard_selection).
  const [didInitSelection, setDidInitSelection] = useState(false);
  useEffect(() => {
    if (didInitSelection || !counts) return;
    setSelectedIds(new Set(allPickerLeafIds(groupReviewPickerRows(counts.byMaterial))));
    setDidInitSelection(true);
  }, [counts, didInitSelection]);

  const selectedSession = useMemo(
    () => pickerSelectionToSessionParams(groups, selectedIds),
    [groups, selectedIds]
  );

  const visibleDueForSelection = useMemo(
    () => visibleDueForLeaves(groups, selectedIds, kind),
    [groups, selectedIds, kind]
  );
  const selectedCourseCount = useMemo(
    () => selectedGroupCount(groups, selectedIds),
    [groups, selectedIds]
  );

  const totalDue = counts?.total ?? 0;
  const moduleTotal = counts?.module ?? 0;
  const personalTotal = counts?.personal ?? 0;

  const toggleLeaf = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: (typeof groups)[number]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allOn = group.leafIds.every((id) => next.has(id));
      for (const id of group.leafIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const allSelected =
    allLeafIds.length > 0 && allLeafIds.every((id) => selectedIds.has(id));

  const confirmDeleteSelected = useCallback(async () => {
    const items = deleteItemsForSelection(groups, selectedIds);
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
      setSelectedIds(new Set());
      setPendingDelete(false);
      setDeletedRefreshKey((k) => k + 1);
      refresh();
    } catch {
      setDeleteError(t.review.deleteSelectedError);
    } finally {
      setDeleting(false);
    }
  }, [groups, selectedIds, refresh, t.review.deleteSelectedError]);

  const startReview = useCallback(
    (overrides?: { all?: boolean }) => {
      const ids = overrides?.all
        ? new Set(allLeafIds)
        : selectedIds;
      const params = pickerSelectionToSessionParams(groups, ids);
      if (params.materialIds.length === 0) return;
      setSessionMode({
        materialIds: params.materialIds,
        noteIds: params.noteIds,
        scope: overrides?.all ? "both" : kind,
        kindBefore: kind,
      });
    },
    [allLeafIds, selectedIds, groups, kind]
  );

  // Free practice: cram cards ignoring the spaced-repetition schedule. Lets the
  // learner keep practising even when nothing is due. Passing no materialIds
  // tells the session API to pull from every owned course; passing a subset
  // limits the cram to the courses they picked.
  const startPractice = useCallback(
    (payload: { materialIds?: string[]; noteIds?: string[] } = {}) => {
      setChoosingPractice(false);
      setSessionMode({
        materialIds: payload.materialIds ?? [],
        noteIds: payload.noteIds,
        scope: "both",
        kindBefore: kind,
        cram: true,
      });
    },
    [kind]
  );

  // ----------- inside a running session -----------
  if (sessionMode) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setSessionMode(null);
            refresh();
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t.review.backToDashboard}
        </button>
        <SrsReviewLauncher
          scope={sessionMode.scope}
          materialIds={sessionMode.materialIds}
          noteIds={sessionMode.noteIds}
          cram={sessionMode.cram}
          sessionKey={`global-${sessionMode.materialIds.slice(0, 4).join(",")}-${sessionMode.noteIds?.slice(0, 4).join(",") ?? ""}-${sessionMode.scope}${sessionMode.cram ? "-cram" : ""}`}
          heading={
            sessionMode.cram ? t.review.freePractice : t.review.globalReview
          }
          showCourseBadge
          onExit={() => {
            setSessionMode(null);
            refresh();
          }}
          onComplete={() => {
            // Don't navigate away — let the summary screen render and the
            // user click "Back" themselves.
            refresh();
          }}
        />
      </div>
    );
  }

  // ----------- free-practice course chooser -----------
  if (choosingPractice) {
    return (
      <FreePracticePanel
        onStart={(payload) => startPractice(payload)}
        onCancel={() => setChoosingPractice(false)}
        onMaterialsChanged={() => setDeletedRefreshKey((k) => k + 1)}
      />
    );
  }

  // ----------- loading / unavailable -----------
  // A timed-out fetch used to leave counts=null and fall through to "0 due /
  // No courses yet" while Choose courses still worked. Keep the skeleton until
  // a successful payload arrives (focus/poll will retry).
  if (!counts) {
    return (
      <section className="space-y-4" data-tour="review-dashboard">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.review.title}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t.review.loadingDecks}</p>
      </section>
    );
  }

  // ----------- empty state (no active decks) -----------
  if (materials.length === 0) {
    return (
      <section className="space-y-6">
        <header data-tour="review-dashboard">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.review.title}
          </h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {t.review.subtitle}
          </p>
        </header>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
            {t.review.allCaughtUpGreat}
          </h2>
          <p className="mt-2 text-sm text-emerald-800/90 dark:text-emerald-200/80">
            {t.review.allCaughtUpEmpty}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => startPractice()}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              {t.review.practiceAnyway}
              <span aria-hidden>→</span>
            </button>
            <button
              type="button"
              onClick={() => setChoosingPractice(true)}
              className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-white px-5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-zinc-950 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              {t.review.chooseCourses}
            </button>
            <a
              href="/dashboard/courses/new"
              className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover"
            >
              {t.review.startNewCourse}
            </a>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              {t.review.backToHome}
            </a>
          </div>
        </div>
        <ReviewDeletedMaterials
          refreshKey={deletedRefreshKey}
          onRestored={refresh}
        />
      </section>
    );
  }

  // ----------- normal dashboard -----------
  return (
    <section className="space-y-8">
      <header className="space-y-2" data-tour="review-dashboard">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.review.title}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t.review.subtitle}</p>
      </header>

      {/* Quick Review (Review All) ---------------------------------- */}
      <div className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-brand-blush/40 to-white p-6 shadow-sm dark:border-zinc-800 dark:from-brand-blush/8 dark:to-zinc-950 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
          {t.review.quickReview}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          {totalDue === 1
            ? t.review.dueTodayCardsOne
            : tf(t.review.dueTodayCards, { count: totalDue })}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {tf(t.review.dueTodayMixed, {
            module: moduleTotal,
            personal: personalTotal,
          })}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => startReview({ all: true })}
            disabled={totalDue === 0}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/15 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {t.review.reviewAll}
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold tabular-nums dark:bg-zinc-900/20">
              {totalDue}
            </span>
          </button>
          <button
            type="button"
            onClick={() => startPractice()}
            title={t.review.practiceAllTitle}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            {t.review.practiceAll}
          </button>
          <button
            type="button"
            onClick={() => setChoosingPractice(true)}
            title={t.review.choosePracticeTitle}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            {t.review.chooseCourses}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          {t.review.practiceAllHintLong}
        </p>
      </div>

      {/* Course selection ------------------------------------------ */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t.review.orChooseCourses}
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setSelectedIds(allSelected ? new Set() : new Set(allLeafIds))
              }
              className="text-xs font-medium text-brand hover:text-brand-hover dark:text-brand-soft"
            >
              {allSelected ? t.review.clearAll : t.review.selectAll}
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || deleting}
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
          selectedIds={selectedIds}
          onToggleLeaf={toggleLeaf}
          onToggleGroup={toggleGroup}
        />
      </div>

      {/* Type filter ----------------------------------------------- */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {t.review.includeLabel}
        </h3>
        <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {(
            [
              { id: "both", label: t.review.includeBoth },
              { id: "module", label: t.review.includeModule },
              { id: "personal", label: t.review.includeFocus },
            ] as { id: ReviewKind; label: string }[]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setKind(opt.id)}
              className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
                kind === opt.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <ReviewQuestionsPreview
        key={`${kind}:${selectedSession.materialIds.join(",")}:${selectedSession.noteIds?.join(",") ?? ""}`}
        materialIds={selectedSession.materialIds}
        noteIds={selectedSession.noteIds}
        scope={kind}
        onChanged={refresh}
      />

      <ReviewDeletedMaterials
        refreshKey={deletedRefreshKey}
        onRestored={refresh}
      />

      {/* Settings --------------------------------------------------- */}
      <ReviewSettingsPanel onChanged={refresh} />

      {/* Start button ---------------------------------------------- */}
      <div className="sticky bottom-4 z-10 -mx-4 border-t border-zinc-200 bg-white/80 px-4 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 sm:mx-0 sm:rounded-2xl sm:border">
        <button
          type="button"
          onClick={() => startReview()}
          disabled={visibleDueForSelection === 0 || selectedCourseCount === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-red-600/25 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
        >
          {t.review.startReview}
          <span className="opacity-90">
            {visibleDueForSelection === 1 && selectedCourseCount === 1
              ? t.review.startReviewDetailOne
              : tf(t.review.startReviewDetail, {
                  count: visibleDueForSelection,
                  courses: selectedCourseCount,
                })}
          </span>
        </button>
      </div>

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
