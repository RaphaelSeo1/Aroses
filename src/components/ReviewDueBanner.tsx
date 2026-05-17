"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSrsDueCounts } from "@/lib/srs-due";

/**
 * Slim "X cards due for review today" banner shown on the dashboard home
 * when the learner has work waiting. Dismissible — but the dismissal is
 * keyed by `YYYY-MM-DD` so it reappears the next calendar day, matching
 * the spec's "reappears next day if there are still due cards".
 */

const STORAGE_KEY = "aroses.srs.banner.dismissedOn";

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReviewDueBanner() {
  const { counts } = useSrsDueCounts(undefined);
  const [dismissedToday, setDismissedToday] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === todayStamp()) setDismissedToday(true);
    } catch {
      /* private browsing — ignore */
    }
  }, []);

  if (!counts || counts.total === 0 || dismissedToday) return null;

  const total = counts.total;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-border/70 bg-brand-blush/70 px-4 py-3 text-sm shadow-sm dark:border-brand-border/40 dark:bg-brand-blush/10">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white"
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 5 7.5V21h6v-3.5c3-1.5 5-4 5-7.5a8 8 0 0 0-8-8Z" />
            <path d="M9 21h6" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="font-medium text-brand-ink dark:text-brand-soft">
            {total} card{total === 1 ? "" : "s"} due for review today
          </p>
          <p className="text-xs text-brand-ink/70 dark:text-brand-soft/70">
            Mixed across {counts.byMaterial.length} course
            {counts.byMaterial.length === 1 ? "" : "s"} — module bank (
            {counts.module}) and focus (
            {counts.personal}).
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/dashboard/review"
          className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          Open review →
        </Link>
        <button
          type="button"
          aria-label="Dismiss until tomorrow"
          onClick={() => {
            try {
              window.localStorage.setItem(STORAGE_KEY, todayStamp());
            } catch {
              /* ignore */
            }
            setDismissedToday(true);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-brand-ink/60 hover:bg-brand-blush hover:text-brand-ink dark:text-brand-soft/60 dark:hover:bg-brand-blush/20 dark:hover:text-brand-soft"
          title="Dismiss until tomorrow"
        >
          ×
        </button>
      </div>
    </div>
  );
}
