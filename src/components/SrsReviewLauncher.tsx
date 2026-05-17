"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SrsReviewSession,
  type SrsSessionCard,
  type SrsSessionSummary,
} from "@/components/SrsReviewSession";

/**
 * Thin wrapper around {@link SrsReviewSession} that fetches a deck from
 * `/api/srs/session` and renders it. Used by:
 *   - CoursePlayer's "Start module quiz" → scope="module", course-scoped
 *   - PersonalQuizSection's "Run focus quiz" → scope="personal", course-scoped
 *   - /dashboard/review's "Start Review" → scope="both", multi-material
 */

export type SrsReviewLauncherProps = {
  /** Scope of cards to pull. Defaults to "both". */
  scope?: "module" | "personal" | "both";
  /** Limit to a single material; omit for cross-course (global) sessions. */
  materialId?: string;
  /** Multi-material filter for the global dashboard. */
  materialIds?: string[];
  /** Limit further to one module within a material. */
  moduleId?: number;
  /** Override new-card-per-day cap for this session. */
  newLimit?: number;
  /** Override max-reviews-per-day cap. */
  maxReviews?: number;
  /** Show course-name chip on each card (true for global review). */
  showCourseBadge?: boolean;
  /** Small label above the deck — e.g. "Module quiz review". */
  heading?: string;
  /** Stable key for localStorage namespacing. */
  sessionKey: string;
  onExit?: () => void;
  onComplete?: (summary: SrsSessionSummary) => void;
};

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; cards: SrsSessionCard[]; totals: SessionTotals };

type SessionTotals = {
  due: number;
  new: number;
  total: number;
};

export function SrsReviewLauncher({
  scope = "both",
  materialId,
  materialIds,
  moduleId,
  newLimit,
  maxReviews,
  showCourseBadge = false,
  heading,
  sessionKey,
  onExit,
  onComplete,
}: SrsReviewLauncherProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (materialId) params.set("materialId", materialId);
      if (materialIds && materialIds.length > 0)
        params.set("materialIds", materialIds.join(","));
      if (typeof moduleId === "number")
        params.set("moduleId", String(moduleId));
      if (typeof newLimit === "number") params.set("newLimit", String(newLimit));
      if (typeof maxReviews === "number")
        params.set("maxReviews", String(maxReviews));

      const res = await fetch(`/api/srs/session?${params.toString()}`);
      const j = (await res.json().catch(() => ({}))) as {
        cards?: SrsSessionCard[];
        totals?: SessionTotals;
        error?: string;
      };
      if (!res.ok) {
        setState({
          status: "error",
          message: j.error || `Could not build session (${res.status}).`,
        });
        return;
      }
      setState({
        status: "ready",
        cards: j.cards ?? [],
        totals: j.totals ?? { due: 0, new: 0, total: 0 },
      });
    } catch (e) {
      setState({
        status: "error",
        message:
          e instanceof Error ? e.message : "Network error building session.",
      });
    }
  }, [
    scope,
    materialId,
    materialIds?.join(","),
    moduleId,
    newLimit,
    maxReviews,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        Loading review session…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-medium">Could not start review</p>
        <p className="mt-1 text-red-700/90 dark:text-red-300/90">
          {state.message}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
          >
            Try again
          </button>
          {onExit ? (
            <button
              type="button"
              onClick={onExit}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-950/40"
            >
              Back
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <SrsReviewSession
      sessionKey={sessionKey}
      cards={state.cards}
      showCourseBadge={showCourseBadge}
      heading={heading}
      onExit={onExit}
      onComplete={onComplete}
    />
  );
}
