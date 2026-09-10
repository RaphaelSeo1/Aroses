"use client";

import { useT } from "@/lib/i18n/LocaleProvider";

type Tone = "error" | "warning";
type Layout = "bar" | "inset";

const TONE: Record<Tone, Record<Layout | "button", string>> = {
  error: {
    bar: "border-b border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100",
    inset:
      "rounded-xl border border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
    button:
      "text-rose-400 hover:bg-rose-100 hover:text-rose-800 dark:hover:bg-rose-900/40 dark:hover:text-rose-100",
  },
  warning: {
    bar: "border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
    inset:
      "rounded-xl border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
    button:
      "text-amber-500 hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-900/40 dark:hover:text-amber-100",
  },
};

/**
 * Persistent page/session error (or warning) bar with a dismiss X.
 * Hiding the banner does not clear underlying data — callers only hide UI.
 */
export function DismissibleInlineBanner({
  children,
  onDismiss,
  tone = "error",
  layout = "inset",
  className = "",
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  tone?: Tone;
  layout?: Layout;
  className?: string;
}) {
  const t = useT();
  const pad = layout === "bar" ? "px-4 py-2 sm:px-6" : "px-4 py-3";

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 text-sm ${pad} ${TONE[tone][layout]} ${className}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t.common.dismiss}
        className={`-mr-1 -mt-0.5 shrink-0 rounded-lg p-1 ${TONE[tone].button}`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
  );
}
