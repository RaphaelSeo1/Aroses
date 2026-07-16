"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  extractLectureSummaryMarkdown,
  LECTURE_SUMMARY_SECTION_ID,
} from "@/lib/live-notes/notes-review";

/**
 * Top-of-notes control: when Finish has written a Lecture summary section,
 * show a button that opens a one-glance panel (and can jump to it in-doc).
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

  const jumpToSummary = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    let targetPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs?.sectionId === LECTURE_SUMMARY_SECTION_ID) {
        targetPos = pos;
        return false;
      }
      return true;
    });
    if (targetPos == null) return;
    const dom = editor.view.nodeDOM(targetPos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ behavior: "smooth", block: "start" });
      dom.classList.add("tn-summary-flash");
      window.setTimeout(() => dom.classList.remove("tn-summary-flash"), 1600);
    }
    setOpen(false);
  }, [editor]);

  if (!markdown) return null;

  // Strip the heading for the panel body — the chrome already says what it is.
  const body = markdown
    .replace(/^##\s+Lecture summary\s*/i, "")
    .trim();

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
        {open ? "Hide lecture summary" : "Lecture summary"}
      </button>

      {open ? (
        <div className="mt-2.5 rounded-2xl border border-violet-200/80 bg-violet-50/40 px-4 py-3 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/30">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
              Exam-morning overview
            </p>
            <button
              type="button"
              onClick={jumpToSummary}
              className="text-[11px] font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
            >
              Jump to in notes
            </button>
          </div>
          <div className="tn-lecture-summary prose-sm text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                ul: (props) => (
                  <ul className="my-0 list-disc space-y-1.5 pl-4" {...props} />
                ),
                ol: (props) => (
                  <ol
                    className="my-0 list-decimal space-y-1.5 pl-4"
                    {...props}
                  />
                ),
                p: (props) => <p className="mb-2 last:mb-0" {...props} />,
                strong: (props) => (
                  <strong className="font-semibold text-zinc-900 dark:text-zinc-50" {...props} />
                ),
                h2: () => null,
                h3: () => null,
              }}
            >
              {body}
            </ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}
