"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LessonRichContent } from "@/components/LessonRichContent";
import type {
  TutorSessionModeTag,
  TutorSessionRecapStatus,
} from "@/types/tutor-session";

/**
 * Recap view for an ended Tutor Session.
 *
 * If the recap is still generating when the page loads (server-side
 * fetch happened mid-generation), we poll the recap endpoint every
 * 1.5s until it lands. Once ready we render it as a Notion-style
 * document via LessonRichContent.
 *
 * Top-of-page actions:
 *   - Download as markdown
 *   - Copy to clipboard
 *   - Regenerate (when status='failed')
 *   - Delete session
 *
 * PDF export + share link are intentionally deferred — they need
 * either a server-side renderer or a public read view, both out of
 * scope for this MVP commit.
 */

type Props = {
  sessionId: string;
  initial: {
    title: string;
    modeTag: TutorSessionModeTag | null;
    durationSeconds: number | null;
    startedAt: string;
    endedAt: string | null;
    recapMarkdown: string | null;
    recapStatus: TutorSessionRecapStatus;
    recapGeneratedAt: string | null;
  };
};

export function TutorRecapView({ sessionId, initial }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<TutorSessionRecapStatus>(initial.recapStatus);
  const [markdown, setMarkdown] = useState<string | null>(initial.recapMarkdown);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [regenerating, setRegenerating] = useState(false);

  // Poll while the recap is still cooking.
  useEffect(() => {
    if (status !== "generating") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tutor-session/${sessionId}/recap`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          recapMarkdown?: string | null;
          recapStatus?: TutorSessionRecapStatus;
        };
        if (cancelled) return;
        if (body.recapStatus) setStatus(body.recapStatus);
        if (body.recapMarkdown) setMarkdown(body.recapMarkdown);
      } catch {
        /* swallow — next tick will retry */
      }
    };
    const interval = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId, status]);

  const copyMarkdown = useCallback(async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch (e) {
      console.error("[TutorRecapView copy]", e);
    }
  }, [markdown]);

  const downloadMarkdown = useCallback(() => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${initial.title.replace(/[^\w-]+/g, "-").slice(0, 60)}-recap.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [initial.title, markdown]);

  const regenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    setStatus("generating");
    try {
      const res = await fetch(`/api/tutor-session/${sessionId}/recap`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`regen failed (${res.status})`);
      const body = (await res.json()) as {
        recapStatus?: TutorSessionRecapStatus;
        recapMarkdown?: string;
      };
      if (body.recapStatus) setStatus(body.recapStatus);
      if (body.recapMarkdown) setMarkdown(body.recapMarkdown);
    } catch (e) {
      console.error("[TutorRecapView regenerate]", e);
      setStatus("failed");
    } finally {
      setRegenerating(false);
    }
  }, [regenerating, sessionId]);

  const deleteSession = useCallback(async () => {
    const ok = window.confirm("Delete this session and its recap?");
    if (!ok) return;
    try {
      const res = await fetch(`/api/tutor-session/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      router.push("/sessions");
    } catch (e) {
      console.error("[TutorRecapView delete]", e);
    }
  }, [router, sessionId]);

  const meta = useMemo(() => {
    const parts: string[] = [];
    if (initial.modeTag) parts.push(initial.modeTag.replace(/_/g, " "));
    if (initial.durationSeconds && initial.durationSeconds > 0)
      parts.push(`${Math.round(initial.durationSeconds / 60)} min`);
    parts.push(
      new Date(initial.endedAt ?? initial.startedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    );
    return parts.join(" · ");
  }, [initial.durationSeconds, initial.endedAt, initial.modeTag, initial.startedAt]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Toolbar */}
        <div className="mb-6 flex items-center justify-between gap-2">
          <Link
            href="/sessions"
            className="text-xs font-medium text-zinc-500 hover:text-violet-700"
          >
            ← All sessions
          </Link>
          <div className="flex items-center gap-1.5">
            {markdown ? (
              <>
                <button
                  type="button"
                  onClick={copyMarkdown}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  {copyState === "copied" ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Download .md
                </button>
              </>
            ) : null}
            {status === "failed" || status === "ready" ? (
              <button
                type="button"
                onClick={regenerate}
                disabled={regenerating}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={deleteSession}
              className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Document */}
        <article className="rounded-3xl border border-white/60 bg-white/95 px-6 py-10 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md sm:px-12 sm:py-14">
          {status === "generating" || (status === "idle" && !markdown) ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7 animate-spin text-violet-600"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" opacity="0.25" />
                <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
              </svg>
              <p className="text-sm font-medium text-zinc-700">
                Rose is putting together your recap…
              </p>
              <p className="text-xs text-zinc-500">
                Usually takes 10-30 seconds.
              </p>
            </div>
          ) : status === "failed" && !markdown ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6">
              <p className="text-sm font-semibold text-rose-900">
                The recap didn&apos;t generate this time.
              </p>
              <p className="mt-1 text-sm text-rose-800">
                Click <b>Regenerate</b> above to try again.
              </p>
            </div>
          ) : markdown ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                Recap · {meta}
              </p>
              <div className="mt-2">
                <LessonRichContent markdown={markdown} />
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              This session was too short to recap.{" "}
              <Link
                href="/tutor-session"
                className="font-medium text-violet-700 underline-offset-2 hover:underline"
              >
                Start a new one
              </Link>
              .
            </p>
          )}
        </article>
      </div>
    </main>
  );
}
