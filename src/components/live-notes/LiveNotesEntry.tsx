"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

      {activeSessions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeSessions.map((s) => (
            <Link
              key={s.id}
              href={`/dashboard/courses/${courseId}/live-notes/${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
            >
              ⏺ Resume: {s.title}
            </Link>
          ))}
        </div>
      ) : null}

      {pastSessions.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700/70 dark:text-rose-300/60">
            Past lectures — notes &amp; transcript
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {pastSessions.map((s) => (
              <Link
                key={s.id}
                href={`/dashboard/courses/${courseId}/live-notes/${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-rose-200 hover:bg-rose-50 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/40"
              >
                📄 {s.title}
                {s.startedAt ? (
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {new Date(s.startedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                ) : null}
              </Link>
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
