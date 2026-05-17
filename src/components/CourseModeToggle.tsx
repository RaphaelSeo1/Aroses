"use client";

import type { CourseMode } from "@/types/mentored";

/**
 * Segmented toggle for switching between the two course experiences:
 *
 *   - Mentored Learning  – active AI tutoring (chunked teach + check)
 *   - Free Exploration   – read at your own pace (existing reading view)
 *
 * Visual language mirrors the practice tabs in CoursePlayer (rounded-full,
 * brand-red selected, ghost idle) so it feels native to the page.
 */
export function CourseModeToggle({
  mode,
  onChange,
  disabled,
  hint,
}: {
  mode: CourseMode;
  onChange: (next: CourseMode) => void;
  disabled?: boolean;
  /** Small italic helper line beneath the toggle. */
  hint?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-900 dark:bg-zinc-900/30 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Course mode
        </p>
        <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
          {mode === "mentored"
            ? "AI tutor walks you through the material with check questions."
            : "Read the course at your own pace; voice tutor on demand."}
        </p>
        {hint ? (
          <p className="mt-1 text-[11px] italic text-zinc-400 dark:text-zinc-500">
            {hint}
          </p>
        ) : null}
      </div>
      <div
        role="tablist"
        aria-label="Course mode"
        className="inline-flex shrink-0 rounded-full bg-white p-1 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800"
      >
        <ModeButton
          active={mode === "mentored"}
          disabled={disabled}
          onClick={() => onChange("mentored")}
          label="Mentored Learning"
        />
        <ModeButton
          active={mode === "free"}
          disabled={disabled}
          onClick={() => onChange("free")}
          label="Free Exploration"
        />
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand"
          : "rounded-full px-4 py-1.5 text-xs font-medium text-zinc-600 transition hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
      }
    >
      {label}
    </button>
  );
}
