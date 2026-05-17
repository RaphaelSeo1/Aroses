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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;

    fetch(`/api/mentored/mode/${materialId}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { mode: "mentored" }))
      .then((body: { mode?: CourseMode }) => {
        if (cancelled) return;
        setModeState(body.mode === "free" ? "free" : "mentored");
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
      setModeState(next);
      // Fire-and-forget — the local optimistic update is the source of truth
      // for UI; the server write is for cross-device sticky state.
      fetch(`/api/mentored/mode/${materialId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      }).catch((e) => console.error("[useCourseMode]", e));
    },
    [materialId]
  );

  return { mode, setMode, loading };
}
