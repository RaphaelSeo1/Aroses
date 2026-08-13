"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FreePracticePanel } from "@/components/FreePracticePanel";
import { ReviewSettingsPanel } from "@/components/ReviewSettingsPanel";
import { SrsReviewLauncher } from "@/components/SrsReviewLauncher";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { deleteReviewMaterials } from "@/lib/review-delete-materials";
import { useSrsDueCounts, type SrsDueByMaterial } from "@/lib/srs-due";

/**
 * Global Review dashboard.
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  You have N cards due today                         │
 *   │  ┌─────────────────────────┐                        │
 *   │  │  Review All  (primary)  │                        │
 *   │  └─────────────────────────┘                        │
 *   │  Or choose specific courses                         │
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
  const { counts, loading, refresh } = useSrsDueCounts(undefined, {
    enabled: true,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ReviewKind>("both");
  const [choosingPractice, setChoosingPractice] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // When true, we are inside a launched session and hide the picker.
  const [sessionMode, setSessionMode] = useState<
    null | {
      materialIds: string[];
      scope: ReviewKind;
      kindBefore: ReviewKind;
      cram?: boolean;
    }
  >(null);

  // Preselect everything once counts arrive (matches the "all" default
  // from the spec; later we'll honor user_srs_prefs.default_dashboard_selection).
  const [didInitSelection, setDidInitSelection] = useState(false);
  useEffect(() => {
    if (didInitSelection || !counts) return;
    setSelectedIds(
      new Set(counts.byMaterial.filter((m) => m.total > 0).map((m) => m.materialId))
    );
    setDidInitSelection(true);
  }, [counts, didInitSelection]);

  const materials = counts?.byMaterial ?? [];
  const selectedMaterials = useMemo(
    () => materials.filter((m) => selectedIds.has(m.materialId)),
    [materials, selectedIds]
  );

  const visibleDueForSelection = useMemo(() => {
    let n = 0;
    for (const m of selectedMaterials) {
      if (kind === "module") n += m.module;
      else if (kind === "personal") n += m.personal;
      else n += m.total;
    }
    return n;
  }, [selectedMaterials, kind]);

  const totalDue = counts?.total ?? 0;
  const moduleTotal = counts?.module ?? 0;
  const personalTotal = counts?.personal ?? 0;

  const toggleMaterial = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected =
    materials.length > 0 && selectedIds.size === materials.length;

  const confirmDeleteSelected = useCallback(async () => {
    const items = materials.filter((m) => selectedIds.has(m.materialId));
    if (items.length === 0) {
      setPendingDelete(false);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteReviewMaterials(
        items.map((m) => ({
          materialId: m.materialId,
          courseId: m.courseId,
        }))
      );
      if (result.failed > 0) {
        setDeleteError(t.review.deleteSelectedError);
      }
      setSelectedIds(new Set());
      setPendingDelete(false);
      refresh();
    } catch {
      setDeleteError(t.review.deleteSelectedError);
    } finally {
      setDeleting(false);
    }
  }, [materials, selectedIds, refresh, t.review.deleteSelectedError]);

  const startReview = useCallback(
    (overrides?: { all?: boolean }) => {
      const ids = overrides?.all
        ? materials.filter((m) => m.total > 0).map((m) => m.materialId)
        : selectedMaterials.map((m) => m.materialId);
      if (ids.length === 0) return;
      setSessionMode({
        materialIds: ids,
        scope: overrides?.all ? "both" : kind,
        kindBefore: kind,
      });
    },
    [materials, selectedMaterials, kind]
  );

  // Free practice: cram cards ignoring the spaced-repetition schedule. Lets the
  // learner keep practising even when nothing is due. Passing no materialIds
  // tells the session API to pull from every owned course; passing a subset
  // limits the cram to the courses they picked.
  const startPractice = useCallback(
    (materialIds: string[] = []) => {
      setChoosingPractice(false);
      setSessionMode({
        materialIds,
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
          cram={sessionMode.cram}
          sessionKey={`global-${sessionMode.materialIds.slice(0, 4).join(",")}-${sessionMode.scope}${sessionMode.cram ? "-cram" : ""}`}
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
        onStart={(ids) => startPractice(ids)}
        onCancel={() => setChoosingPractice(false)}
      />
    );
  }

  // ----------- loading skeleton -----------
  if (loading && !counts) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.review.title}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t.review.loadingDecks}</p>
      </section>
    );
  }

  // ----------- empty state (no decks at all) -----------
  if (counts && materials.length === 0) {
    return (
      <section className="space-y-6">
        <header>
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
      </section>
    );
  }

  // ----------- normal dashboard -----------
  return (
    <section className="space-y-8">
      <header className="space-y-2">
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
                setSelectedIds(
                  allSelected
                    ? new Set()
                    : new Set(materials.map((m) => m.materialId))
                )
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

        <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {materials.length === 0 ? (
            <li className="px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
              {t.review.noCoursesYet}
            </li>
          ) : (
            materials.map((m, idx) => (
              <CourseRow
                key={m.materialId}
                material={m}
                checked={selectedIds.has(m.materialId)}
                disabled={false}
                caughtUp={m.total === 0}
                onToggle={() => toggleMaterial(m.materialId)}
                isLast={idx === materials.length - 1}
              />
            ))
          )}
        </ul>
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

      {/* Settings --------------------------------------------------- */}
      <ReviewSettingsPanel onChanged={refresh} />

      {/* Start button ---------------------------------------------- */}
      <div className="sticky bottom-4 z-10 -mx-4 border-t border-zinc-200 bg-white/80 px-4 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 sm:mx-0 sm:rounded-2xl sm:border">
        <button
          type="button"
          onClick={() => startReview()}
          disabled={visibleDueForSelection === 0 || selectedMaterials.length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-red-600/25 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
        >
          {t.review.startReview}
          <span className="opacity-90">
            {visibleDueForSelection === 1 && selectedMaterials.length === 1
              ? t.review.startReviewDetailOne
              : tf(t.review.startReviewDetail, {
                  count: visibleDueForSelection,
                  courses: selectedMaterials.length,
                })}
          </span>
        </button>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title={
          selectedIds.size === 1
            ? t.review.deleteSelectedTitleOne
            : tf(t.review.deleteSelectedTitle, { count: selectedIds.size })
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

function CourseRow({
  material,
  checked,
  disabled,
  caughtUp,
  onToggle,
  isLast,
}: {
  material: SrsDueByMaterial;
  checked: boolean;
  disabled: boolean;
  caughtUp: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const t = useT();
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
        isLast ? "" : "border-b border-zinc-100 dark:border-zinc-900"
      } ${caughtUp ? "bg-zinc-50/50 dark:bg-zinc-900/30" : ""}`}
    >
      <input
        type="checkbox"
        checked={!disabled && checked}
        disabled={disabled}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-brand focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${
            caughtUp
              ? "text-zinc-500 dark:text-zinc-500"
              : "text-zinc-900 dark:text-zinc-100"
          }`}
        >
          {material.courseTitle ?? material.fileName}
        </p>
        {material.courseTitle && material.courseTitle !== material.fileName ? (
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-500">
            {material.fileName}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
        {caughtUp ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {t.review.allCaughtUpPill}
          </span>
        ) : (
          <>
            <Pill label={t.review.moduleLabel} value={material.module} tone="brand" />
            <Pill label={t.review.focusLabel} value={material.personal} tone="zinc" />
            <span className="ml-1 font-semibold text-zinc-900 dark:text-zinc-100">
              {material.total}
            </span>
          </>
        )}
      </div>
    </li>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "zinc";
}) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500">
        {label} 0
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
        tone === "brand"
          ? "bg-brand-blush text-brand-ink dark:bg-brand-blush/15 dark:text-brand-soft"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      }`}
    >
      {label} {value}
    </span>
  );
}
