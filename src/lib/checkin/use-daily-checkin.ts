"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckInPublicStatus } from "@/lib/checkin/types";

export type CheckInClientStatus = CheckInPublicStatus & {
  plusGranted: boolean;
  plusGrantPeriodEnd: string | null;
  plusGrantSkippedHigherPlan: boolean;
  alreadyCheckedIn: boolean;
  justCheckedIn: boolean;
};

const EVENT = "aroses:daily-checkin";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function broadcast(status: CheckInClientStatus) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: status }));
}

export function useDailyCheckIn(opts?: {
  enabled?: boolean;
  initial?: CheckInClientStatus | null;
}): {
  status: CheckInClientStatus | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  checkIn: () => Promise<CheckInClientStatus | null>;
} {
  const enabled = opts?.enabled !== false;
  const [status, setStatus] = useState<CheckInClientStatus | null>(
    opts?.initial ?? null
  );
  const [loading, setLoading] = useState(opts?.initial == null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipMount = useRef(opts?.initial != null);

  const apply = useCallback((next: CheckInClientStatus) => {
    setStatus(next);
    broadcast(next);
  }, []);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CheckInClientStatus>).detail;
      if (detail) setStatus(detail);
    };
    window.addEventListener(EVENT, onUpdate);
    return () => window.removeEventListener(EVENT, onUpdate);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (skipMount.current) {
      skipMount.current = false;
      setLoading(false);
    }
    let cancelled = false;
    const tz = encodeURIComponent(browserTimeZone());
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/checkin?tz=${tz}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as CheckInClientStatus;
        if (!cancelled) {
          setStatus(json);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const checkIn = useCallback(async () => {
    if (busy) return status;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ timeZone: browserTimeZone() }),
      });
      const json = (await res.json().catch(() => ({}))) as CheckInClientStatus & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "error");
        return null;
      }
      apply(json);
      return json;
    } catch {
      setError("error");
      return null;
    } finally {
      setBusy(false);
    }
  }, [apply, busy, status]);

  return { status, loading, busy, error, checkIn };
}

export async function fireCheckInConfetti(big = false) {
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    const colors = ["#e11d48", "#fb7185", "#fda4af", "#fbbf24", "#34d399"];
    const base = {
      colors,
      zIndex: 80,
      disableForReducedMotion: true as const,
    };
    confetti({
      ...base,
      particleCount: big ? 140 : 70,
      spread: big ? 90 : 70,
      startVelocity: 36,
      origin: { y: 0.7 },
    });
  } catch {
    /* optional */
  }
}
