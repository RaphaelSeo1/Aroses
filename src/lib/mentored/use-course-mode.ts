"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseMode } from "@/types/mentored";

/**
 * Loads + persists the Mentored vs. Free Exploration mode for a given course.
 *
 * Returns the current `mode`, a `setMode(next)` that optimistically updates
 * local state + fires off a PUT to the server, and a `loading` flag for the
 * initial fetch. New courses default to "mentored" if no row exists.
 */
export function useCourseMode(materialId: string): {
  mode: CourseMode;
  setMode: (next: CourseMode) => void;
  loading: boolean;
} {
  const [mode, setModeState] = useState<CourseMode>("mentored");
  const [loading, setLoading] = useState(true);
  const inflight = useRef<AbortController | null>(null);
  /** When the user (or parent) sets mode locally, ignore stale GET responses. */
  const userSetRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    userSetRef.current = false;
    setLoading(true);
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;

    fetch(`/api/mentored/mode/${materialId}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { mode: "mentored" }))
      .then((body: { mode?: CourseMode }) => {
        if (cancelled || userSetRef.current) return;
        const resolved = body.mode === "free" ? "free" : "mentored";
        console.log("[mode-persist] loaded", { materialId, mode: resolved });
        setModeState(resolved);
      })
      .catch(() => {
        if (!cancelled) setModeState("mentored");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [materialId]);

  const setMode = useCallback(
    (next: CourseMode) => {
      console.log("[mode-persist] saving", { materialId, mode: next });
      userSetRef.current = true;
      setModeState(next);
      // Fire-and-forget — the local optimistic update is the source of truth
      // for UI; the server write is for cross-device sticky state.
      fetch(`/api/mentored/mode/${materialId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      })
        .then((r) => {
          if (!r.ok) {
            console.error("[mode-persist] save failed", { materialId, status: r.status });
          }
        })
        .catch((e) => console.error("[useCourseMode]", e));
    },
    [materialId]
  );

  return { mode, setMode, loading };
}
