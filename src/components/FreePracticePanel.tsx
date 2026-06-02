"use client";

import { useEffect, useMemo, useState } from "react";

type ScopeMaterial = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  moduleQuestions: number;
  personalQuestions: number;
  total: number;
};

type ScopeResponse = {
  materials: ScopeMaterial[];
  totals: { module: number; personal: number; total: number };
};

/**
 * Course chooser for free practice (cram). Lists every course with its total
 * practiceable questions so the learner can pick which courses to drill,
 * ignoring the spaced-repetition schedule. Passing the selected material IDs
 * (or none, for "everything") up to the dashboard launches the cram session.
 */
export function FreePracticePanel({
  onStart,
  onCancel,
}: {
  /** `materialIds` empty = practice everything. */
  onStart: (materialIds: string[]) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<ScopeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
        // Default: everything selected.
        setSelected(new Set(json.materials.map((m) => m.materialId)));
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

  const materials = useMemo(() => data?.materials ?? [], [data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedList = useMemo(
    () => materials.filter((m) => selected.has(m.materialId)),
    [materials, selected]
  );
  const selectedQuestionTotal = useMemo(
    () => selectedList.reduce((n, m) => n + m.total, 0),
    [selectedList]
  );
  const allSelected = materials.length > 0 && selected.size === materials.length;

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
          brand-new questions. Pick the courses you want to cram.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Loading your courses…
        </p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : materials.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          Nothing to practice yet. Once you&apos;ve answered some quiz
          questions or saved focus cards, they&apos;ll show up here to drill.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {materials.length} course{materials.length === 1 ? "" : "s"} ·{" "}
              {data?.totals.total ?? 0} questions total
            </span>
            <button
              type="button"
              onClick={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(materials.map((m) => m.materialId))
                )
              }
              className="text-xs font-medium text-brand hover:text-brand-hover dark:text-brand-soft"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>

          <ul className="max-h-[22rem] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            {materials.map((m, idx) => {
              const checked = selected.has(m.materialId);
              return (
                <li
                  key={m.materialId}
                  className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
                    idx === materials.length - 1
                      ? ""
                      : "border-b border-zinc-100 dark:border-zinc-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(m.materialId)}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-brand focus:ring-brand"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {m.courseTitle ?? m.fileName}
                    </p>
                    {m.courseTitle && m.courseTitle !== m.fileName ? (
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-500">
                        {m.fileName}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                    {m.personalQuestions > 0 ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        +{m.personalQuestions} focus
                      </span>
                    ) : null}
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {m.total}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-4 z-10 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => onStart(selectedList.map((m) => m.materialId))}
              disabled={selectedList.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Start free practice
              <span className="opacity-90">
                ({selectedQuestionTotal} question
                {selectedQuestionTotal === 1 ? "" : "s"} from{" "}
                {selectedList.length} course
                {selectedList.length === 1 ? "" : "s"})
              </span>
            </button>
            <button
              type="button"
              onClick={() => onStart([])}
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-3.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Practice everything
            </button>
          </div>
        </>
      )}
    </section>
  );
}
