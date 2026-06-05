"use client";

import { useState } from "react";
import { LessonRichContent } from "@/components/LessonRichContent";

export function CombinedNotesModal({
  markdown,
  sessionCount,
  onClose,
}: {
  markdown: string;
  sessionCount: number;
  onClose: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      /* ignore */
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `combined-study-notes-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Combined study notes"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Combined study notes
            </p>
            <p className="text-xs text-zinc-500">
              Merged from {sessionCount} sessions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
            >
              {copyState === "copied" ? "Copied!" : "Copy"}
            </button>
            <button
              type="button"
              onClick={download}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
            >
              Download .md
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <LessonRichContent markdown={markdown} />
        </div>
      </div>
    </div>
  );
}
