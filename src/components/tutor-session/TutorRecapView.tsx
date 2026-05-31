"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/AppDialogs";
import { LessonRichContent } from "@/components/LessonRichContent";
import {
  TutorRecapEditor,
  type TutorRecapEditorHandle,
} from "@/components/tutor-session/TutorRecapEditor";
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
 *   - Edit          → switch to a textarea, save back via PUT /recap
 *   - Copy          → markdown to clipboard
 *   - Download .md  → save markdown as a file
 *   - Print / PDF   → window.print() — the recap stylesheet is print-clean
 *   - Share         → toggle public read-only link (/share/session/[token])
 *   - Regenerate    → POST /recap (used when status='failed' or to retry)
 *   - To course     → convert the recap into a structured Aroses course
 *   - Delete        → hard-delete the session + uploads
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
  const [linkCopyState, setLinkCopyState] = useState<"idle" | "copied">("idle");
  const [regenerating, setRegenerating] = useState(false);

  // Edit mode — when active, swap the rendered article for a
  // TipTap-backed rich editor. The editor's content is uncontrolled;
  // the parent only reads its markdown via the editor ref at Save time
  // so we don't re-render the entire document tree per keystroke.
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<TutorRecapEditorHandle | null>(null);
  const [editorSeed, setEditorSeed] = useState<string>(
    initial.recapMarkdown ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Share toggle — null = off / loading; string = current public token.
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareToggling, setShareToggling] = useState(false);

  // To-course CTA state.
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  // On mount, pull the current share state so the toggle reflects
  // reality. (We don't include it in the initial server fetch to
  // keep that payload narrow.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tutor-session/${sessionId}/share`);
        const body = (await res.json().catch(() => ({}))) as {
          shareToken?: string | null;
          error?: string;
        };
        if (cancelled) return;
        if (body.error) {
          setShareError(body.error);
          return;
        }
        if (!res.ok) return;
        setShareToken(body.shareToken ?? null);
      } catch (e) {
        console.error("[TutorRecapView share GET]", e);
        if (!cancelled) {
          setShareError(
            "Couldn't load share status. If this is a new install, apply migration 037_tutor_session_share.sql in Supabase."
          );
        }
      } finally {
        if (!cancelled) setShareLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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

  // Edit / save
  const beginEdit = useCallback(() => {
    setEditorSeed(markdown ?? "");
    setEditing(true);
    setSaveError(null);
  }, [markdown]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setSaveError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (saving) return;
    const next = editorRef.current?.getMarkdown() ?? "";
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/tutor-session/${sessionId}/recap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recapMarkdown: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setMarkdown(next);
      setEditing(false);
    } catch (e) {
      console.error("[TutorRecapView saveEdit]", e);
      setSaveError("Couldn't save edits. Try again.");
    } finally {
      setSaving(false);
    }
  }, [saving, sessionId]);

  // Share toggle
  const toggleShare = useCallback(async () => {
    if (shareToggling) return;
    const next = !shareToken;
    setShareToggling(true);
    setShareError(null);
    try {
      const res = await fetch(`/api/tutor-session/${sessionId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res
        .json()
        .catch(() => ({}))) as {
        shareToken?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.error ?? `Share toggle failed (${res.status})`
        );
      }
      setShareToken(body.shareToken ?? null);
      if (next && body.shareToken) {
        // Auto-copy the freshly-minted link so the user doesn't have
        // to find the "Copy link" button after enabling.
        try {
          const url = `${window.location.origin}/share/session/${body.shareToken}`;
          await navigator.clipboard.writeText(url);
          setLinkCopyState("copied");
          window.setTimeout(() => setLinkCopyState("idle"), 1600);
        } catch {
          /* clipboard might be denied — the Copy link button still works */
        }
      }
    } catch (e) {
      console.error("[TutorRecapView toggleShare]", e);
      setShareError(
        e instanceof Error
          ? e.message
          : "Couldn't toggle sharing. Try again."
      );
    } finally {
      setShareToggling(false);
    }
  }, [sessionId, shareToggling, shareToken]);

  const copyShareLink = useCallback(async () => {
    if (!shareToken) return;
    const url = `${window.location.origin}/share/session/${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopyState("copied");
      window.setTimeout(() => setLinkCopyState("idle"), 1600);
    } catch (e) {
      console.error("[TutorRecapView copyShareLink]", e);
      setShareError(
        "Couldn't copy link — your browser blocked clipboard access."
      );
    }
  }, [shareToken]);

  // PDF export — uses the print dialog so users can pick their
  // preferred print path (Save as PDF on macOS / Win / iOS / Android).
  // The article's existing rounded-card chrome looks fine in print
  // since the surrounding gradient page background hides cleanly.
  const printPdf = useCallback(() => {
    if (!markdown) return;
    window.print();
  }, [markdown]);

  // To course
  const turnIntoCourse = useCallback(async () => {
    if (converting) return;
    setConverting(true);
    setConvertError(null);
    try {
      const res = await fetch(
        `/api/tutor-session/${sessionId}/to-course`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        courseId?: string;
        materialId?: string;
        error?: string;
      };
      if (!res.ok || !body.courseId) {
        throw new Error(body.error ?? `Convert failed (${res.status})`);
      }
      router.push(`/dashboard?course=${body.courseId}`);
    } catch (e) {
      console.error("[TutorRecapView turnIntoCourse]", e);
      setConvertError(
        e instanceof Error
          ? e.message
          : "Couldn't turn this into a course. Try again."
      );
      setConverting(false);
    }
  }, [converting, router, sessionId]);

  const deleteSession = useCallback(async () => {
    const ok = await confirmDialog({
      title: "Delete this session?",
      body: "This permanently removes the session and its recap.",
      confirmLabel: "Delete",
      tone: "danger",
    });
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

  const shareEnabled = Boolean(shareToken);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-app-gradient print:bg-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 print:py-0">
        {/* Toolbar — hidden in print */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link
            href="/sessions"
            className="text-xs font-medium text-zinc-500 hover:text-violet-700"
          >
            ← All sessions
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            {markdown && !editing ? (
              <>
                <button
                  type="button"
                  onClick={beginEdit}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Edit
                </button>
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
                <button
                  type="button"
                  onClick={printPdf}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                  title="Open the print dialog — choose 'Save as PDF'"
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={toggleShare}
                  disabled={shareLoading || shareToggling}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    shareEnabled
                      ? "border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  title={
                    shareEnabled
                      ? "Stop sharing — link will stop working"
                      : "Generate a public read-only link"
                  }
                >
                  {shareToggling
                    ? shareEnabled
                      ? "Stopping…"
                      : "Generating link…"
                    : shareEnabled
                      ? "Sharing: On"
                      : "Share"}
                </button>
                {shareEnabled ? (
                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    {linkCopyState === "copied" ? "Link copied!" : "Copy link"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={turnIntoCourse}
                  disabled={converting}
                  title="Build a structured course from this session"
                  className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  {converting ? "Building course…" : "Turn into course"}
                </button>
              </>
            ) : null}
            {!editing && (status === "failed" || status === "ready") ? (
              <button
                type="button"
                onClick={regenerate}
                disabled={regenerating}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            ) : null}
            {!editing ? (
              <button
                type="button"
                onClick={deleteSession}
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
              >
                Delete
              </button>
            ) : null}
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {convertError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800 print:hidden">
            {convertError}
          </div>
        ) : null}
        {saveError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800 print:hidden">
            {saveError}
          </div>
        ) : null}
        {shareError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800 print:hidden">
            {shareError}
          </div>
        ) : null}

        {/* Document */}
        <article className="rounded-3xl border border-white/60 bg-white/95 px-6 py-10 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md sm:px-12 sm:py-14 print:rounded-none print:border-0 print:shadow-none print:ring-0">
          {editing ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                Editing recap
              </p>
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-inner">
                <TutorRecapEditor
                  key={editorSeed}
                  initialMarkdown={editorSeed}
                  editorRef={editorRef}
                />
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Type like a normal doc — bold, italics, headings, lists,
                quotes, and checkboxes all just work. Saving keeps the same
                shareable format under the hood.
              </p>
            </div>
          ) : status === "generating" || (status === "idle" && !markdown) ? (
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
