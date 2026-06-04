"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function VisibilitySwitch({
  checked,
  disabled,
  onChange,
  id,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  id: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-8 w-[3.25rem] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-emerald-500 dark:bg-emerald-500"
          : "bg-zinc-300 dark:bg-zinc-600",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out",
          checked ? "translate-x-[1.35rem]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

export function CourseVisibilityToggle({
  courseId,
  initialPublic,
  listingBlocksExplore = false,
  marketplaceEnabled = true,
}: {
  courseId: string;
  initialPublic: boolean;
  /** When a marketplace listing exists (draft/review/live). */
  listingBlocksExplore?: boolean;
  marketplaceEnabled?: boolean;
}) {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchId = `course-public-${courseId}`;

  async function apply(next: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.error === "string" ? body.error : "Could not update."
        );
        setPending(false);
        return;
      }
      setIsPublic(next);
      router.refresh();
    } catch {
      setError("Network error.");
    }
    setPending(false);
  }

  return (
    <div className="rounded-2xl border border-zinc-200/90 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Public Explore listing
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {marketplaceEnabled ? (
          <>
            Free Explore and paid marketplace listings are mutually exclusive. Use{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              Sell this course
            </span>{" "}
            below for paid listings, or this switch for free community sharing.
          </>
        ) : (
          <>
            When public, anyone signed in can discover and study this course on
            Explore. When private, only you can access it from your dashboard.
          </>
        )}
      </p>

      {marketplaceEnabled && listingBlocksExplore ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          A marketplace listing is active or in progress. Delist or wait for
          review before enabling free Explore.
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-zinc-200/80 bg-zinc-50/60 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <label htmlFor={switchId} className="min-w-0 cursor-pointer">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Make this course public
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {isPublic
              ? "Listed on Explore — anyone signed in can discover it."
              : "Private — only you can see it from your dashboard."}
          </p>
        </label>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              isPublic
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200"
                : "bg-zinc-200/80 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
            ].join(" ")}
          >
            {pending ? "Saving…" : isPublic ? "Public" : "Private"}
          </span>
          <VisibilitySwitch
            id={switchId}
            checked={isPublic}
            disabled={pending || (marketplaceEnabled && listingBlocksExplore)}
            onChange={(next) => void apply(next)}
          />
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
