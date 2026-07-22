"use client";

import { useState } from "react";
import { AI_ASSISTANT_NAME } from "@/lib/brand";

export type RoseAssistantTab = "ask" | "refine";

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-3.5 w-3.5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/**
 * Segmented tab header shared by the Ask and Refine panels. Both panels sit at
 * the same fixed position, so switching tabs reads as one tabbed assistant.
 * When `canRefine` is false the Refine tab is shown locked/grayed with a note
 * explaining the student can't edit a course they don't own.
 */
export function RoseAssistantTabs({
  active,
  canRefine,
  onSelectAsk,
  onSelectRefine,
  refineBusy = false,
}: {
  active: RoseAssistantTab;
  canRefine: boolean;
  onSelectAsk: () => void;
  onSelectRefine: () => void;
  /** Adds a small "editing" dot to the Refine tab while a job runs. */
  refineBusy?: boolean;
}) {
  const [showLocked, setShowLocked] = useState(false);

  return (
    <div className="shrink-0 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      <div
        role="tablist"
        aria-label={`${AI_ASSISTANT_NAME} tools`}
        className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
      >
        <button
          type="button"
          role="tab"
          aria-selected={active === "ask"}
          onClick={onSelectAsk}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
            active === "ask"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          Ask
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={active === "refine"}
          aria-disabled={!canRefine}
          title={
            canRefine
              ? undefined
              : "You don't have access to make changes to this course"
          }
          onClick={() => {
            if (canRefine) {
              onSelectRefine();
              return;
            }
            setShowLocked((v) => !v);
          }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
            !canRefine
              ? "cursor-not-allowed text-zinc-400 dark:text-zinc-600"
              : active === "refine"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {!canRefine ? <LockIcon className="h-3 w-3" /> : null}
          Refine
          {canRefine && refineBusy ? (
            <span
              className="ml-0.5 h-1.5 w-1.5 rounded-full bg-brand"
              aria-hidden
            />
          ) : null}
        </button>
      </div>

      {!canRefine && showLocked ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] leading-snug text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          <LockIcon className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            You don&apos;t have access to make changes to this course. Refining
            is only available to the course owner.
          </span>
        </p>
      ) : null}
    </div>
  );
}
