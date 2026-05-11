"use client";

import { useMemo, useState } from "react";
import type { QuizReviewStatsDto } from "@/types/quiz-review";
import type { CourseQuizItem } from "@/types/course";
import { isQuizMcq } from "@/types/course";

type Filter = "all" | "correct" | "incorrect" | "unattempted";

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type Props = {
  quiz: CourseQuizItem[];
  reviewByIndex: Record<string, QuizReviewStatsDto | undefined>;
  /** When nested inside another panel (e.g. focus section) — no heavy top margin/border */
  embedded?: boolean;
  /**
   * When placed directly under a page header that already has a bottom rule —
   * avoids a second divider + huge empty strip between lines.
   */
  compact?: boolean;
  /** Short line under the title (e.g. scope vs focus cards). */
  bankScopeHint?: string;
  /** Omit title + description (e.g. parent supplies heading and tabs). */
  showHeader?: boolean;
  /** Override copy when every question has zero attempts (default mentions module quiz). */
  allUnattemptedHint?: string;
  /**
   * When set, filters (+ optional scope hint) stay sticky at the top of this
   * scrollable area; only the question list scrolls.
   */
  scrollAreaClassName?: string;
};

export function ModuleQuizReview({
  quiz,
  reviewByIndex,
  embedded,
  compact,
  bankScopeHint,
  showHeader = true,
  allUnattemptedHint,
  scrollAreaClassName,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const rows = useMemo(() => {
    return quiz.map((item, quizIndex) => {
      const stats = reviewByIndex[String(quizIndex)];
      const lastOk = stats?.lastIsCorrect;
      const attempts = stats?.attemptCount ?? 0;
      return { item, quizIndex, stats, lastOk, attempts };
    });
  }, [quiz, reviewByIndex]);

  const filtered = useMemo(() => {
    return rows.filter(({ lastOk, attempts }) => {
      if (filter === "all") return true;
      if (filter === "unattempted") return attempts === 0;
      if (filter === "correct") return attempts > 0 && lastOk === true;
      if (filter === "incorrect") return attempts > 0 && lastOk === false;
      return true;
    });
  }, [rows, filter]);

  const counts = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;
    for (const r of rows) {
      if (r.attempts === 0) unattempted++;
      else if (r.lastOk === true) correct++;
      else if (r.lastOk === false) incorrect++;
    }
    return { correct, incorrect, unattempted, total: rows.length };
  }, [rows]);

  const toggleExpanded = (qi: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(qi)) next.delete(qi);
      else next.add(qi);
      return next;
    });
  };

  if (quiz.length === 0) {
    return null;
  }

  const filterPills: { id: Filter; label: string; hint?: string }[] = [
    { id: "all", label: "All", hint: String(counts.total) },
    {
      id: "correct",
      label: "Last try ✓",
      hint: String(counts.correct),
    },
    {
      id: "incorrect",
      label: "Last try ✗",
      hint: String(counts.incorrect),
    },
    {
      id: "unattempted",
      label: "Not tried",
      hint: String(counts.unattempted),
    },
  ];

  const filterMargin =
    scrollAreaClassName ? "" : showHeader ? "mt-4" : "mt-3";

  const filterRow = (
    <div className={`flex flex-wrap gap-2 ${filterMargin}`}>
      {filterPills.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          onClick={() => setFilter(id)}
          className={`transition-none inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
            filter === id
              ? "border-brand bg-brand-blush text-brand-ink dark:border-brand dark:bg-brand-blush/8 dark:text-brand-blush"
              : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-600"
          }`}
        >
          {label}
          <span className="rounded-md bg-white/80 px-1.5 py-0 text-[10px] text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400">
            {hint}
          </span>
        </button>
      ))}
    </div>
  );

  const unattemptedBanner =
    counts.total > 0 && counts.unattempted === counts.total ? (
      <p
        className={
          scrollAreaClassName
            ? "mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-2.5 text-xs leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400 sm:text-sm"
            : "mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400"
        }
      >
        {allUnattemptedHint ??
          "No attempts logged yet. Start the module quiz below to build your review history."}
      </p>
    ) : null;

  const scopeHintStandalone =
    !scrollAreaClassName && !showHeader && bankScopeHint ? (
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
        {bankScopeHint}
      </p>
    ) : null;

  const stickyScopeHint =
    scrollAreaClassName && !showHeader && bankScopeHint ? (
      <p className="text-[10px] font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
        {bankScopeHint}
      </p>
    ) : null;

  const listItems = filtered.map(({ item, quizIndex, stats, lastOk, attempts }) => {
          const open = expanded.has(quizIndex);
          const isMc = isQuizMcq(item);
          const status =
            attempts === 0
              ? "unattempted"
              : lastOk === true
                ? "correct"
                : "incorrect";

          return (
            <li
              key={quizIndex}
              className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/35"
            >
              <button
                type="button"
                onClick={() => toggleExpanded(quizIndex)}
                className="transition-none flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-white/60 dark:hover:bg-zinc-950/50"
              >
                <span className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-lg bg-white text-xs font-semibold text-zinc-500 shadow-sm ring-1 ring-zinc-200/80 dark:bg-zinc-950 dark:text-zinc-400 dark:ring-zinc-700">
                  {quizIndex + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                        isMc
                          ? "bg-brand-blush text-brand-ink dark:bg-brand-blush/15 dark:text-brand-blush"
                          : "bg-brand-blush text-brand-ink dark:bg-brand-blush/15 dark:text-brand-blush"
                      }`}
                    >
                      {isMc ? "Multiple choice" : "Short answer"}
                    </span>
                    {attempts === 0 ? (
                      <span className="rounded-md bg-zinc-200/80 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        Not tried
                      </span>
                    ) : lastOk === true ? (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
                        Last try correct
                      </span>
                    ) : (
                      <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-900 dark:bg-red-950/60 dark:text-red-200">
                        Last try incorrect
                      </span>
                    )}
                    {attempts > 1 ? (
                      <span className="text-[11px] text-zinc-500">
                        {attempts} attempts
                      </span>
                    ) : null}
                    {stats?.lastAttemptAt ? (
                      <span className="text-[11px] text-zinc-400">
                        {formatShortDate(stats.lastAttemptAt)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1.5 block text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                    {open ? item.question : truncate(item.question, 140)}
                  </span>
                </span>
                <span className="shrink-0 text-zinc-400">
                  {open ? "−" : "+"}
                </span>
              </button>

              {open ? (
                <div className="space-y-4 border-t border-zinc-200/80 bg-white/70 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                  <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                    {item.question}
                  </p>

                  {isMc ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Answer key
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {item.choices.map((c, i) => {
                          const letter = String.fromCharCode(65 + i);
                          const isAns = i === item.correctIndex;
                          return (
                            <li
                              key={i}
                              className={`rounded-lg border px-3 py-2 text-sm ${
                                isAns
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
                                  : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                              }`}
                            >
                              <span className="font-mono text-xs text-zinc-500">
                                {letter}.
                              </span>{" "}
                              {c}
                              {isAns ? (
                                <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                  (correct)
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {status === "incorrect" &&
                      stats?.lastSelectedChoice != null &&
                      stats.lastSelectedChoice >= 0 &&
                      stats.lastSelectedChoice <= 3 ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          Your last quiz picked slot{" "}
                          <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                            {String.fromCharCode(
                              65 + stats.lastSelectedChoice
                            )}
                          </strong>{" "}
                          (positions were shuffled during that run).
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Model answer (rubric)
                      </p>
                      <p className="mt-2 whitespace-pre-wrap rounded-lg border border-brand-border bg-brand-blush/80 px-3 py-2.5 text-sm text-brand-ink dark:border-brand-border/50 dark:bg-brand-blush/10 dark:text-brand-blush">
                        {item.referenceAnswer}
                      </p>
                      {status === "incorrect" ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          Short answers are graded by the tutor; your wording may
                          still pass if it meets these ideas.
                        </p>
                      ) : null}
                    </div>
                  )}

                  <details className="group rounded-xl border border-zinc-200 bg-zinc-50/90 dark:border-zinc-700 dark:bg-zinc-900/50">
                    <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-zinc-600 marker:hidden dark:text-zinc-400 [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-2">
                        <span className="text-zinc-400 group-open:rotate-90">
                          ▸
                        </span>
                        Explanation
                      </span>
                    </summary>
                    <p className="border-t border-zinc-200 px-3 py-2 text-sm leading-relaxed text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                      {item.explanation}
                    </p>
                  </details>
                </div>
              ) : null}
            </li>
          );
        });

  const questionListBlock = (
    <>
      <ul
        className={`space-y-3 ${scrollAreaClassName ? "mt-0" : "mt-5"}`}
      >
        {listItems}
      </ul>

      {filtered.length === 0 ? (
        <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No questions match this filter.
        </p>
      ) : null}
    </>
  );

  return (
    <section
      className={
        embedded
          ? "mt-0 border-0 pt-0"
          : compact
            ? "mt-5 border-0 pt-1 dark:border-transparent"
            : "mt-10 border-t border-zinc-100 pt-8 dark:border-zinc-900"
      }
    >
      {showHeader ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3
              className={
                embedded
                  ? "text-base font-semibold text-zinc-900 dark:text-zinc-100"
                  : "text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              }
            >
              Question review
            </h3>
            {bankScopeHint && !embedded ? (
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
                {bankScopeHint}
              </p>
            ) : null}
            <p
              className={
                embedded
                  ? "mt-1 text-xs text-zinc-600 dark:text-zinc-400"
                  : "mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400"
              }
            >
              {embedded
                ? "Your attempts and answer key — filters below."
                : "Module quiz bank for this module only — not your private focus questions (see Question review → Focus questions). Latest result and answer key per question. MC options shuffle during quizzes; choices below stay in source order."}
            </p>
          </div>
        </div>
      ) : null}

      {scrollAreaClassName ? (
        <div className={`${scrollAreaClassName}${showHeader ? " mt-4" : ""}`}>
          <div className="sticky top-0 z-[1] space-y-2 border-b border-zinc-200/90 bg-white/95 px-3 pb-3 pt-3 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95">
            {stickyScopeHint}
            {filterRow}
            {unattemptedBanner}
          </div>
          <div className="px-2 pb-3 pt-3 sm:px-3">{questionListBlock}</div>
        </div>
      ) : (
        <>
          {scopeHintStandalone}
          {filterRow}
          {unattemptedBanner}
          {questionListBlock}
        </>
      )}
    </section>
  );
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}
