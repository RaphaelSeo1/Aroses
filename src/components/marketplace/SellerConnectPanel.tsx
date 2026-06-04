"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

type ConnectState = {
  configured: boolean;
  ready: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
};

export function SellerConnectPanel({
  initialState,
  returnPath,
}: {
  initialState: ConnectState;
  returnPath: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startOnboarding = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/marketplace/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnPath }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof json.error === "string" ? json.error : "Could not start setup.");
        return;
      }
      if (typeof json.url === "string") {
        window.location.href = json.url;
        return;
      }
      setErr("Stripe did not return a setup link.");
    } finally {
      setBusy(false);
    }
  }, [returnPath]);

  const refreshStatus = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/marketplace/connect");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const account = json.account as
        | {
            ready?: boolean;
            chargesEnabled?: boolean;
            detailsSubmitted?: boolean;
          }
        | null
        | undefined;
      setState({
        configured: Boolean(json.configured),
        ready: Boolean(account?.ready),
        chargesEnabled: Boolean(account?.chargesEnabled),
        detailsSubmitted: Boolean(account?.detailsSubmitted),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [router]);

  if (!state.configured) {
    return (
      <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/80 p-5 dark:border-amber-900/50 dark:bg-amber-950/25">
        <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
          Payouts not configured
        </p>
        <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-200/90">
          Add <code className="text-xs">STRIPE_SECRET_KEY</code> to enable
          marketplace payments.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
        Seller payouts
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Connect a Stripe account to receive payments when learners buy your
        courses. Required before you can submit a listing for review.
      </p>

      <p
        className={`mt-4 text-sm font-semibold ${
          state.ready
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-amber-700 dark:text-amber-300"
        }`}
      >
        {state.ready
          ? "Payout account ready"
          : state.detailsSubmitted
            ? "Stripe is verifying your account"
            : "Payout setup incomplete"}
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void startOnboarding()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {state.ready ? "Update payout details" : "Set up payouts"}
        </button>
        {!state.ready ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshStatus()}
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100"
          >
            Refresh status
          </button>
        ) : null}
      </div>

      {err ? (
        <p className="mt-4 text-sm leading-relaxed text-red-600 dark:text-red-400">
          {err}
          {/Connect is not enabled/i.test(err) ? (
            <>
              {" "}
              <a
                href="https://dashboard.stripe.com/connect"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Open Stripe Connect setup
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
