"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { LessonRichContent } from "@/components/LessonRichContent";
import { extractLectureSummaryMarkdown } from "@/lib/live-notes/notes-review";

/**
 * Top-of-notes control: when Finish has written a tutor-style lecture recap,
 * show a button that opens it (same kind of recap as tutor sessions).
 */
export function LectureSummaryButton({ editor }: { editor: Editor | null }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setMarkdown(null);
      return;
    }
    setMarkdown(extractLectureSummaryMarkdown(editor.getJSON()));
  }, [editor]);

  useEffect(() => {
    refresh();
    if (!editor) return;
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, refresh]);

  if (!markdown) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
          open
            ? "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200"
            : "border-zinc-200 bg-white text-zinc-700 hover:border-violet-200 hover:bg-violet-50/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-800"
        }`}
      >
        <span aria-hidden>📋</span>
        {open ? "Hide lecture recap" : "Lecture recap"}
      </button>

      {open ? (
        <div className="mt-2.5 max-h-[min(70vh,36rem)] overflow-y-auto rounded-2xl border border-violet-200/80 bg-white px-4 py-4 shadow-sm dark:border-violet-900/60 dark:bg-zinc-950">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
            Session recap
          </p>
          <article className="text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-200">
            <LessonRichContent markdown={markdown} />
          </article>
        </div>
      ) : null}
    </div>
  );
}
