"use client";

import { useCallback, useState } from "react";

export function BuyCourseButton({
  courseId,
  priceLabel,
  paymentsEnabled,
}: {
  courseId: string;
  priceLabel: string;
  paymentsEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buy = useCallback(async () => {
    if (!paymentsEnabled) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/marketplace/courses/${courseId}/checkout`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof json.error === "string" ? json.error : "Could not start checkout.");
        return;
      }
      if (typeof json.url === "string") {
        window.location.href = json.url;
        return;
      }
      setErr("Checkout did not return a payment link.");
    } finally {
      setBusy(false);
    }
  }, [courseId, paymentsEnabled]);

  if (!paymentsEnabled) {
    return (
      <>
        <button
          type="button"
          disabled
          className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-full bg-zinc-400 px-8 py-3.5 text-sm font-semibold text-white opacity-90 sm:w-auto"
        >
          Buy — coming soon
        </button>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Payments are not configured yet on this environment.
        </p>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void buy()}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/25 transition hover:bg-brand-hover disabled:opacity-50 sm:w-auto dark:bg-brand dark:hover:bg-brand-soft"
      >
        {busy ? "Opening checkout…" : `Buy for ${priceLabel}`}
      </button>
      <p className="max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Secure checkout via Stripe. Full lessons unlock immediately after
        payment.
      </p>
      {err ? (
        <p className="w-full text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : null}
    </>
  );
}
