"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { alertDialog } from "@/components/AppDialogs";

type PlanTier = "free" | "student" | "premium";

type Props = {
  userId: string;
  email: string;
  tier: PlanTier;
  status: string;
  adminGranted: boolean;
};

const TIER_OPTIONS: { value: PlanTier; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "student", label: "Student" },
  { value: "premium", label: "Premium" },
];

const STATUS_OPTIONS = [
  "inactive",
  "active",
  "trialing",
  "past_due",
  "canceled",
] as const;

function tierBadgeClass(tier: PlanTier): string {
  if (tier === "premium") {
    return "bg-violet-50 text-violet-800 ring-violet-600/15 dark:bg-violet-950/50 dark:text-violet-200 dark:ring-violet-500/30";
  }
  if (tier === "student") {
    return "bg-sky-50 text-sky-800 ring-sky-600/15 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-500/30";
  }
  return "bg-zinc-100 text-zinc-700 ring-zinc-500/15 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-500/25";
}

export function AdminUserPlanEditor({
  userId,
  email,
  tier,
  status,
  adminGranted,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextTier, setNextTier] = useState<PlanTier>(tier);
  const [nextStatus, setNextStatus] = useState(status || "inactive");
  const [saving, setSaving] = useState(false);

  const openEditor = () => {
    setNextTier(tier);
    setNextStatus(status || "inactive");
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/subscription`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: nextTier, status: nextStatus }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        await alertDialog({
          title: "Couldn’t update plan",
          body: j.error ?? "Request failed.",
          tone: "danger",
        });
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-[7.5rem]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize ring-1 ${tierBadgeClass(tier)}`}
        >
          {tier}
        </span>
        <span className="text-[10px] capitalize text-zinc-500 dark:text-zinc-400">
          {status || "inactive"}
        </span>
        {adminGranted ? (
          <span
            className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-medium text-amber-800 ring-1 ring-amber-600/15 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/30"
            title="Set by admin (not Stripe)"
          >
            admin
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={openEditor}
        className="mt-1 text-[10px] font-medium text-[#DC2626] underline-offset-2 hover:underline"
      >
        Change plan
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`plan-edit-${userId}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3
              id={`plan-edit-${userId}`}
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Change subscription
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {email}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Updates plan limits in the app. Does not charge or cancel Stripe.
              Paid grants are marked admin so reconcile won’t wipe them.
            </p>

            <label className="mt-4 block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              Plan
              <select
                value={nextTier}
                onChange={(e) => setNextTier(e.target.value as PlanTier)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 outline-none focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {TIER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              Status
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 outline-none focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-[#DC2626] px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
