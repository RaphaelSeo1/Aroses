"use client";

import { useEffect, useState } from "react";

/**
 * Client-side React hook that polls `/api/srs/due-counts` so the UI can show
 * "Review 12 due cards" style CTAs and a nav badge. Polls on a slow cadence
 * (60s) plus a `window.focus` refresh so coming back to the tab always shows
 * fresh numbers.
 */

export type SrsDueByMaterial = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  module: number;
  personal: number;
  total: number;
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
  opts?: { enabled?: boolean; refreshKey?: number | string }
): { counts: SrsDueCounts | null; loading: boolean; refresh: () => void } {
  const enabled = opts?.enabled !== false;
  const refreshKey = opts?.refreshKey;
  const [counts, setCounts] = useState<SrsDueCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualBump, setManualBump] = useState(0);

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
        const res = await fetch(url);
        if (!res.ok) throw new Error(`due-counts ${res.status}`);
        const json = (await res.json()) as SrsDueCounts;
        if (!cancelled) setCounts(json);
      } catch (e) {
        if (!cancelled) {
          console.warn("[srs due-counts]", e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchCounts();
    const interval = window.setInterval(fetchCounts, POLL_INTERVAL_MS);
    const onFocus = () => void fetchCounts();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, materialId, refreshKey, manualBump]);

  return {
    counts,
    loading,
    refresh: () => setManualBump((n) => n + 1),
  };
}
