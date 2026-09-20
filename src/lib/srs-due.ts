"use client";

import { useEffect, useRef, useState } from "react";
import { sharedJsonGet } from "@/lib/widget-json-fetch";

/**
 * Client-side React hook that polls `/api/srs/due-counts` so the UI can show
 * "Review 12 due cards" style CTAs and a nav badge. Polls on a slow cadence
 * (60s) plus a `window.focus` refresh so coming back to the tab always shows
 * fresh numbers.
 */

/** Focus cards from one note, nested under a course/material picker row. */
export type SrsDueNoteChild = {
  /** `note:{uuid}` or legacy `"notes"`. */
  materialId: string;
  sourceNoteId: string | null;
  /** Note title. */
  fileName: string;
  personal: number;
  total: number;
};

export type SrsDueByMaterial = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  module: number;
  personal: number;
  total: number;
  /** Present when personal cards can be attributed to distinct notes. */
  notes?: SrsDueNoteChild[];
  /** Notes-hub folder id (`user_note_sections`) when the note is not course-linked. */
  sectionId?: string | null;
  /** Current folder title from `user_note_sections` — never a hardcoded name. */
  sectionTitle?: string | null;
  hubKind?: "custom" | "live" | "tutor" | "standalone" | null;
};

export type SrsDueCounts = {
  total: number;
  module: number;
  personal: number;
  byMaterial: SrsDueByMaterial[];
};

const POLL_INTERVAL_MS = 60_000;

export function useSrsDueCounts(
  materialId?: string,
  opts?: {
    enabled?: boolean;
    refreshKey?: number | string;
    initialCounts?: SrsDueCounts | null;
    /** Override the shared widget client abort (Review needs longer). */
    timeoutMs?: number;
  }
): { counts: SrsDueCounts | null; loading: boolean; refresh: () => void } {
  const enabled = opts?.enabled !== false;
  const refreshKey = opts?.refreshKey;
  const initialCounts = opts?.initialCounts;
  const timeoutMs = opts?.timeoutMs;
  const [counts, setCounts] = useState<SrsDueCounts | null>(
    initialCounts ?? null
  );
  const [loading, setLoading] = useState(initialCounts == null);
  const [manualBump, setManualBump] = useState(0);
  const skipMountFetchRef = useRef(initialCounts != null);

  useEffect(() => {
    if (!enabled) {
      setCounts(null);
      return;
    }
    let cancelled = false;

    const fetchCounts = async () => {
      setLoading(true);
      try {
        const url = materialId
          ? `/api/srs/due-counts?materialId=${encodeURIComponent(materialId)}`
          : `/api/srs/due-counts`;
        const json =
          timeoutMs != null
            ? await sharedJsonGet<SrsDueCounts>(url, timeoutMs)
            : await sharedJsonGet<SrsDueCounts>(url);
        if (!cancelled) setCounts(json);
      } catch (e) {
        if (!cancelled) {
          console.warn("[srs due-counts]", e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // SSR already hydrated the nav badge — skip the mount fetch and only
    // refresh on the slow poll / window focus so we don't double-hit Supabase
    // on every page load (several components mount this hook).
    if (!skipMountFetchRef.current) {
      void fetchCounts();
    }
    skipMountFetchRef.current = false;
    const interval = window.setInterval(fetchCounts, POLL_INTERVAL_MS);
    const onFocus = () => void fetchCounts();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, materialId, refreshKey, manualBump, timeoutMs]);

  return {
    counts,
    loading,
    refresh: () => setManualBump((n) => n + 1),
  };
}
