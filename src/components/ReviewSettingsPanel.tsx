"use client";

import { useEffect, useState } from "react";

/**
 * Lightweight settings + danger-zone panel for the Review dashboard.
 * Calls `/api/srs/prefs` for the editable knobs and `/api/srs/reset` for
 * the resets.
 */

type Prefs = {
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  defaultDashboardSelection: "all" | "last" | "none";
  showCourseBadge: boolean;
  dailyReviewGoal: number;
};

const DEFAULTS: Prefs = {
  newCardsPerDay: 20,
  maxReviewsPerDay: 100,
  defaultDashboardSelection: "all",
  showCourseBadge: true,
  dailyReviewGoal: 30,
};

export function ReviewSettingsPanel({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/srs/prefs");
        if (!res.ok) return;
        const j = (await res.json()) as Partial<Prefs>;
        if (cancelled) return;
        setPrefs((cur) => ({ ...cur, ...j }));
      } catch {
        /* fall through to defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const savePrefs = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/srs/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMessage("Saved.");
      onChanged?.();
    } catch {
      setMessage("Could not save. Try again.");
    } finally {
      setSaving(false);
      window.setTimeout(() => setMessage(null), 2000);
    }
  };

  const resetAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/srs/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "all" }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMessage("All SRS progress reset.");
      onChanged?.();
    } catch {
      setMessage("Reset failed. Try again.");
    } finally {
      setSaving(false);
      setConfirmingReset(false);
      window.setTimeout(() => setMessage(null), 2500);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <svg
            className="h-4 w-4 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
          Review settings
        </span>
        <span className="text-xs text-zinc-400">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? (
        <div className="space-y-5 border-t border-zinc-100 px-5 py-5 dark:border-zinc-900">
          <NumberField
            label="New cards per day"
            value={prefs.newCardsPerDay}
            min={0}
            max={500}
            onChange={(v) =>
              setPrefs((p) => ({ ...p, newCardsPerDay: v }))
            }
            helper="How many never-seen cards to introduce per review session."
          />
          <NumberField
            label="Max reviews per day"
            value={prefs.maxReviewsPerDay}
            min={1}
            max={2000}
            onChange={(v) =>
              setPrefs((p) => ({ ...p, maxReviewsPerDay: v }))
            }
            helper="Hard cap on the deck size for a single session."
          />
          <NumberField
            label="Daily review goal"
            value={prefs.dailyReviewGoal}
            min={0}
            max={1000}
            onChange={(v) =>
              setPrefs((p) => ({ ...p, dailyReviewGoal: v }))
            }
            helper="Used by progress widgets; not enforced."
          />

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Default dashboard selection
            </label>
            <div className="mt-2 inline-flex rounded-full border border-zinc-200 bg-white p-1 text-sm dark:border-zinc-800 dark:bg-zinc-950">
              {(
                [
                  { id: "all", label: "All courses" },
                  { id: "last", label: "Last used" },
                  { id: "none", label: "Nothing" },
                ] as { id: Prefs["defaultDashboardSelection"]; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      defaultDashboardSelection: opt.id,
                    }))
                  }
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${
                    prefs.defaultDashboardSelection === opt.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={prefs.showCourseBadge}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, showCourseBadge: e.target.checked }))
              }
              className="h-4 w-4 rounded border-zinc-300 text-brand focus:ring-brand"
            />
            Show course badge on cards during global review
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void savePrefs()}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {message ? (
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {message}
              </span>
            ) : null}
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
              Danger zone
            </p>
            <p className="mt-1 text-sm text-red-800/90 dark:text-red-200/90">
              Reset all spaced-repetition progress across every course. Every
              card becomes &ldquo;new&rdquo; again. Attempt history is preserved.
            </p>
            {!confirmingReset ? (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className="mt-3 inline-flex items-center justify-center rounded-full border border-red-300 bg-white px-4 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
              >
                Reset all SRS progress…
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void resetAll()}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Yes, reset everything
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-950/40"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  helper,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="mt-1.5 block w-32 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {helper ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          {helper}
        </p>
      ) : null}
    </label>
  );
}
