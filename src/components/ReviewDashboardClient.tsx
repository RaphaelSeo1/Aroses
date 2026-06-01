"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewSettingsPanel } from "@/components/ReviewSettingsPanel";
import { SrsReviewLauncher } from "@/components/SrsReviewLauncher";
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
  const { counts, loading, refresh } = useSrsDueCounts(undefined, {
    enabled: true,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ReviewKind>("both");
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

  // Free practice: cram every card across all courses, ignoring the schedule.
  // Lets the learner keep practising even when nothing is due. Passing no
  // materialIds tells the session API to pull from every owned course.
  const startPractice = useCallback(() => {
    setSessionMode({
      materialIds: [],
      scope: "both",
      kindBefore: kind,
      cram: true,
    });
  }, [kind]);

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
          ← Back to Review dashboard
        </button>
        <SrsReviewLauncher
          scope={sessionMode.scope}
          materialIds={sessionMode.materialIds}
          cram={sessionMode.cram}
          sessionKey={`global-${sessionMode.materialIds.slice(0, 4).join(",")}-${sessionMode.scope}${sessionMode.cram ? "-cram" : ""}`}
          heading={sessionMode.cram ? "Free practice" : "Global review"}
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

  // ----------- loading skeleton -----------
  if (loading && !counts) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Review
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">Loading your decks…</p>
      </section>
    );
  }

  // ----------- empty state (nothing due AND no cards anywhere yet) -----------
  if (counts && totalDue === 0) {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Review
          </h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Spaced repetition across every course you&apos;re studying.
          </p>
        </header>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
            You&apos;re all caught up, great work.
          </h2>
          <p className="mt-2 text-sm text-emerald-800/90 dark:text-emerald-200/80">
            Nothing is due right now. Come back tomorrow, start a new course,
            or run a free practice on a course you&apos;ve already mastered.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={startPractice}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Practice anyway
              <span aria-hidden>→</span>
            </button>
            <a
              href="/dashboard/courses/new"
              className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover"
            >
              Start a new course
            </a>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Back to home
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
          Review
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Spaced repetition across every course you&apos;re studying.
        </p>
      </header>

      {/* Quick Review (Review All) ---------------------------------- */}
      <div className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-brand-blush/40 to-white p-6 shadow-sm dark:border-zinc-800 dark:from-brand-blush/8 dark:to-zinc-950 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
          Quick review
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          You have {totalDue} card{totalDue === 1 ? "" : "s"} due today
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Mixed review across all your courses — module bank ({moduleTotal})
          and focus cards ({personalTotal}).
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => startReview({ all: true })}
            disabled={totalDue === 0}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/15 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Review all
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold tabular-nums dark:bg-zinc-900/20">
              {totalDue}
            </span>
          </button>
          <button
            type="button"
            onClick={startPractice}
            title="Practice every card across all your courses, ignoring the review schedule."
            className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Practice all
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          Practice all ignores the schedule and serves every card — great for cramming before an exam.
        </p>
      </div>

      {/* Course selection ------------------------------------------ */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Or choose specific courses
          </h3>
          <button
            type="button"
            onClick={() =>
              setSelectedIds(
                new Set(materials.filter((m) => m.total > 0).map((m) => m.materialId))
              )
            }
            className="text-xs font-medium text-brand hover:text-brand-hover dark:text-brand-soft"
          >
            Select all
          </button>
        </div>

        <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {materials.length === 0 ? (
            <li className="px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
              No courses yet — start one and your due cards will show up here.
            </li>
          ) : (
            materials.map((m, idx) => (
              <CourseRow
                key={m.materialId}
                material={m}
                checked={selectedIds.has(m.materialId)}
                disabled={m.total === 0}
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
          Include
        </h3>
        <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {(
            [
              { id: "both", label: "Both" },
              { id: "module", label: "Module only" },
              { id: "personal", label: "Focus only" },
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
          Start review
          <span className="opacity-90">
            ({visibleDueForSelection} card{visibleDueForSelection === 1 ? "" : "s"}{" "}
            from {selectedMaterials.length} course
            {selectedMaterials.length === 1 ? "" : "s"})
          </span>
        </button>
      </div>
    </section>
  );
}

function CourseRow({
  material,
  checked,
  disabled,
  onToggle,
  isLast,
}: {
  material: SrsDueByMaterial;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
        isLast ? "" : "border-b border-zinc-100 dark:border-zinc-900"
      } ${disabled ? "bg-zinc-50/50 dark:bg-zinc-900/30" : ""}`}
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
            disabled
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
        {disabled ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            All caught up
          </span>
        ) : (
          <>
            <Pill label="Module" value={material.module} tone="brand" />
            <Pill label="Focus" value={material.personal} tone="zinc" />
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
