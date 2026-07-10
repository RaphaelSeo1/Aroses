"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/AppDialogs";

export type LiveNotesActiveSession = {
  id: string;
  title: string;
  startedAt: string;
};

/**
 * Course-page entry point for Live Notes: starts a new capture session,
 * offers "Resume" chips for in-flight sessions left behind by a closed tab,
 * and lists completed lectures so their notes + transcript stay reachable
 * after the course is built.
 */
export function LiveNotesEntry({
  courseId,
  activeSessions,
  pastSessions = [],
}: {
  courseId: string;
  activeSessions: LiveNotesActiveSession[];
  pastSessions?: LiveNotesActiveSession[];
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(activeSessions);
  const [past, setPast] = useState(pastSessions);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setActive(activeSessions);
  }, [activeSessions]);

  useEffect(() => {
    setPast(pastSessions);
  }, [pastSessions]);

  const startSession = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/live-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!res.ok || !data.sessionId) {
        setError(data.error || "Could not start a live session.");
        setStarting(false);
        return;
      }
      router.push(`/dashboard/courses/${courseId}/live-notes/${data.sessionId}`);
    } catch {
      setError("Could not start a live session. Check your connection.");
      setStarting(false);
    }
  };

  const deleteSession = async (
    session: LiveNotesActiveSession,
    kind: "active" | "past"
  ) => {
    if (deletingId) return;
    const ok = await confirmDialog({
      title: `Delete “${session.title}”?`,
      body:
        "This cannot be undone. The recording, transcript, and notes for this lecture will be removed.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    setDeletingId(session.id);
    setError(null);
    try {
      const res = await fetch(`/api/live-notes/${session.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not delete this lecture.");
        return;
      }
      if (kind === "active") {
        setActive((prev) => prev.filter((s) => s.id !== session.id));
      } else {
        setPast((prev) => prev.filter((s) => s.id !== session.id));
      }
      router.refresh();
    } catch {
      setError("Could not delete this lecture. Check your connection.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/50 dark:bg-rose-950/25">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-800 dark:text-rose-200">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            Live notes
          </p>
          <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
            Record a lecture live — Rose takes running notes and builds a full
            course when it ends.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startSession()}
          disabled={starting}
          className="rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
        >
          {starting ? "Starting…" : "Record live lecture"}
        </button>
      </div>

      {active.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {active.map((s) => (
            <div
              key={s.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-rose-300 bg-white py-1 pl-3 pr-1 text-xs font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <Link
                href={`/dashboard/courses/${courseId}/live-notes/${s.id}`}
                className="min-w-0 truncate hover:underline"
              >
                ⏺ Resume: {s.title}
              </Link>
              <button
                type="button"
                onClick={() => void deleteSession(s, "active")}
                disabled={deletingId === s.id}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-rose-400 hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50 dark:hover:bg-rose-900/50 dark:hover:text-rose-200"
                aria-label={`Delete ${s.title}`}
                title="Delete lecture"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {past.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700/70 dark:text-rose-300/60">
            Past lectures — notes &amp; transcript
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {past.map((s) => (
              <div
                key={s.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-white py-1 pl-3 pr-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300"
              >
                <Link
                  href={`/dashboard/courses/${courseId}/live-notes/${s.id}`}
                  className="min-w-0 truncate hover:border-rose-200 hover:text-rose-800 dark:hover:text-rose-200"
                  title={s.title}
                >
                  📄 {s.title}
                </Link>
                <button
                  type="button"
                  onClick={() => void deleteSession(s, "past")}
                  disabled={deletingId === s.id}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label={`Delete ${s.title}`}
                  title="Delete lecture"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}
