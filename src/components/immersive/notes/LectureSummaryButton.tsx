"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { LessonRichContent } from "@/components/LessonRichContent";
import { extractLectureSummaryMarkdown } from "@/lib/live-notes/notes-review";

/**
 * Top-of-notes control for the tutor-style lecture recap (generated on Finish
 * or via Generate). Always visible on live-notes surfaces when
 * `generateEndpoint` is set; otherwise only when markdown exists.
 */
export function LectureSummaryButton({
  editor,
  contentRevision = 0,
  seedMarkdown = null,
  generateEndpoint = null,
}: {
  editor: Editor | null;
  /** Bumped after async hydrate so we re-read attrs even when emitUpdate is false. */
  contentRevision?: number;
  /** Recap from server JSON before/without relying on editor transactions. */
  seedMarkdown?: string | null;
  /** When set, show the control even if recap is missing (live lecture notes). */
  generateEndpoint?: string | null;
}) {
  const [markdown, setMarkdown] = useState<string | null>(seedMarkdown);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setMarkdown(seedMarkdown);
      return;
    }
    setMarkdown(
      extractLectureSummaryMarkdown(editor.getJSON()) ?? seedMarkdown
    );
  }, [editor, seedMarkdown]);

  useEffect(() => {
    refresh();
    if (!editor) return;
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, refresh, contentRevision]);

  useEffect(() => {
    if (seedMarkdown) setMarkdown(seedMarkdown);
  }, [seedMarkdown]);

  const applyRecap = useCallback(
    (md: string) => {
      setMarkdown(md);
      setOpen(true);
      setError(null);
      if (editor && !editor.isDestroyed) {
        editor.commands.updateAttributes("doc", { roseLectureRecap: md });
      }
    },
    [editor]
  );

  const handleGenerate = useCallback(async () => {
    if (!generateEndpoint || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(generateEndpoint, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        recapMarkdown?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error || "Could not generate lecture recap.");
        return;
      }
      const md =
        typeof body.recapMarkdown === "string" ? body.recapMarkdown.trim() : "";
      if (!md) {
        setError("Could not generate lecture recap.");
        return;
      }
      applyRecap(md);
    } catch {
      setError("Could not generate lecture recap.");
    } finally {
      setGenerating(false);
    }
  }, [applyRecap, generateEndpoint, generating]);

  if (!markdown && !generateEndpoint) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {markdown ? (
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
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            <span aria-hidden>📋</span>
            Lecture recap
          </span>
        )}
        {generateEndpoint ? (
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50/80 px-3 py-1.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/70"
          >
            {generating
              ? "Generating…"
              : markdown
                ? "Regenerate"
                : "Generate recap"}
          </button>
        ) : null}
      </div>
      {!markdown && generateEndpoint && !generating && !error ? (
        <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          Created automatically when you Finish — or generate now from the
          transcript.
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      {open && markdown ? (
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
