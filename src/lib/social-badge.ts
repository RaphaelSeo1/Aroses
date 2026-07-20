"use client";

import { useEffect, useRef, useState } from "react";
import { MESSAGING_REFRESH_EVENT } from "@/lib/messaging/realtime";
import type { SocialBadgeCounts } from "@/lib/messaging/social-badge-types";

const POLL_INTERVAL_MS = 45_000;

const EMPTY: SocialBadgeCounts = {
  unreadMessages: 0,
  pendingFriendRequests: 0,
  total: 0,
};

export type { SocialBadgeCounts };

/**
 * Polls social badge counts (unread messages + pending friend requests).
 * Refreshes on focus and whenever messaging/friends UI dispatches a refresh.
 */
export function useSocialBadgeCounts(opts?: {
  enabled?: boolean;
  initialCounts?: SocialBadgeCounts | null;
}): {
  counts: SocialBadgeCounts;
  loading: boolean;
  refresh: () => void;
} {
  const enabled = opts?.enabled !== false;
  const initialCounts = opts?.initialCounts;
  const [counts, setCounts] = useState<SocialBadgeCounts>(
    initialCounts ?? EMPTY
  );
  const [loading, setLoading] = useState(initialCounts == null);
  const [manualBump, setManualBump] = useState(0);
  const skipMountFetchRef = useRef(initialCounts != null);

  useEffect(() => {
    if (!enabled) {
      setCounts(EMPTY);
      return;
    }
    let cancelled = false;

    const fetchCounts = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/social/badge-counts");
        if (!res.ok) throw new Error(`badge-counts ${res.status}`);
        const json = (await res.json()) as SocialBadgeCounts;
        if (!cancelled) {
          setCounts({
            unreadMessages: Number(json.unreadMessages) || 0,
            pendingFriendRequests: Number(json.pendingFriendRequests) || 0,
            total: Number(json.total) || 0,
          });
        }
      } catch (e) {
        if (!cancelled) console.warn("[social badge-counts]", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!skipMountFetchRef.current) {
      void fetchCounts();
    }
    skipMountFetchRef.current = false;

    const interval = window.setInterval(fetchCounts, POLL_INTERVAL_MS);
    const onFocus = () => void fetchCounts();
    const onRefresh = () => void fetchCounts();
    window.addEventListener("focus", onFocus);
    window.addEventListener(MESSAGING_REFRESH_EVENT, onRefresh);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(MESSAGING_REFRESH_EVENT, onRefresh);
    };
  }, [enabled, manualBump]);

  return {
    counts,
    loading,
    refresh: () => setManualBump((n) => n + 1),
  };
}

export function formatBadgeCount(n: number): string {
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
}
