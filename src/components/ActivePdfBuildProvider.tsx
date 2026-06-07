"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildSessionId,
  dismissPdfBuildSession,
  isTheaterPageForSession,
  loadPdfBuildSessions,
  sessionBuildHref,
  summarizeSession,
  upsertPdfBuildSession,
  type ActivePdfBuildSession,
  type PdfBuildSessionStatus,
} from "@/lib/active-pdf-builds";
import {
  pollPdfIngestJob,
  type PdfBuildProgressUI,
} from "@/lib/pdf-ingest-client";

type RegisterInput = {
  courseId: string;
  courseTitle: string;
  sectionId?: string | null;
  jobIds: string[];
  labels?: Record<string, string>;
};

type ActivePdfBuildContextValue = {
  registerSession: (input: RegisterInput) => string;
  updateJobProgress: (
    sessionId: string,
    jobId: string,
    info: PdfBuildProgressUI
  ) => void;
  updateJobTerminal: (
    sessionId: string,
    jobId: string,
    outcome: { materialId?: string; error?: string }
  ) => void;
  updateLabels: (sessionId: string, labels: Record<string, string>) => void;
  markSessionStatus: (sessionId: string, status: PdfBuildSessionStatus) => void;
};

const ActivePdfBuildContext = createContext<ActivePdfBuildContextValue | null>(
  null
);

export function useActivePdfBuild(): ActivePdfBuildContextValue {
  const ctx = useContext(ActivePdfBuildContext);
  if (!ctx) {
    throw new Error("useActivePdfBuild must be used within ActivePdfBuildProvider");
  }
  return ctx;
}

/** Optional hook — safe outside provider (returns null). */
export function useActivePdfBuildOptional(): ActivePdfBuildContextValue | null {
  return useContext(ActivePdfBuildContext);
}

function BackgroundPdfJobPoll({
  session,
  jobId,
  skip,
  onProgress,
  onDone,
}: {
  session: ActivePdfBuildSession;
  jobId: string;
  skip: boolean;
  onProgress: (jobId: string, info: PdfBuildProgressUI) => void;
  onDone: (
    jobId: string,
    outcome: { materialId?: string; error?: string }
  ) => void;
}) {
  useEffect(() => {
    if (skip) return;
    const ac = new AbortController();
    void (async () => {
      const result = await pollPdfIngestJob(
        jobId,
        (info) => {
          if (!ac.signal.aborted) onProgress(jobId, info);
        },
        { signal: ac.signal }
      );
      if (!ac.signal.aborted) onDone(jobId, result);
    })();
    return () => ac.abort();
  }, [jobId, skip, onProgress, onDone]);
  return null;
}

function ActivePdfBuildDock({
  sessions,
  onDismiss,
}: {
  sessions: ActivePdfBuildSession[];
  onDismiss: (sessionId: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search =
    typeof window !== "undefined" ? window.location.search : "";

  const visible = sessions.filter(
    (s) => !isTheaterPageForSession(pathname, search, s)
  );
  if (visible.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-[min(100vw-2rem,22rem)] flex-col gap-2 sm:bottom-6 sm:right-6"
      aria-live="polite"
    >
      {visible.map((session) => {
        const { headline, detail, bar } = summarizeSession(session);
        const href = sessionBuildHref(session);
        const firstMaterial = session.jobIds
          .map((id) => session.terminalByJob[id]?.materialId)
          .find((m) => typeof m === "string" && m.length > 0);
        const isDone = session.status !== "running";
        const courseHome = session.sectionId
          ? `/dashboard/courses/${session.courseId}?section=${encodeURIComponent(session.sectionId)}`
          : `/dashboard/courses/${session.courseId}`;

        return (
          <div
            key={session.sessionId}
            className="pointer-events-auto overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-[0_20px_50px_-20px_rgba(60,60,90,0.35)] ring-1 ring-zinc-200/80 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/95 dark:ring-zinc-700"
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
                  isDone && session.status === "success"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : isDone
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                      : "bg-brand/10 text-brand"
                }`}
                aria-hidden
              >
                {isDone ? (session.status === "success" ? "✓" : "!") : "◐"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                  {headline}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-zinc-600 dark:text-zinc-400">
                  {session.courseTitle}
                  {detail ? ` · ${detail}` : ""}
                </p>
                {!isDone && bar != null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    {bar === "indeterminate" ? (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-brand/70" />
                    ) : (
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-500"
                        style={{ width: `${Math.min(100, bar)}%` }}
                      />
                    )}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(session.sessionId)}
                className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="flex border-t border-zinc-100 dark:border-zinc-800">
              <Link
                href={href}
                className="flex-1 px-3 py-2 text-center text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {isDone ? "View build" : "Open build"}
              </Link>
              {isDone && firstMaterial ? (
                <button
                  type="button"
                  onClick={() => {
                    router.push(
                      `/dashboard/courses/${session.courseId}/study?material=${encodeURIComponent(firstMaterial)}`
                    );
                  }}
                  className="flex-1 border-l border-zinc-100 px-3 py-2 text-center text-[12px] font-semibold text-brand hover:bg-brand/5 dark:border-zinc-800"
                >
                  Study now
                </button>
              ) : (
                <Link
                  href={courseHome}
                  className="flex-1 border-l border-zinc-100 px-3 py-2 text-center text-[12px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Course home
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ActivePdfBuildProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sessions, setSessions] = useState<ActivePdfBuildSession[]>([]);
  const refresh = useCallback(() => {
    setSessions(loadPdfBuildSessions());
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = () => refresh();
    window.addEventListener("rose:pdf-build-sessions", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("rose:pdf-build-sessions", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  const registerSession = useCallback((input: RegisterInput) => {
    const sessionId = buildSessionId(input.courseId, input.jobIds);
    upsertPdfBuildSession({
      sessionId,
      courseId: input.courseId,
      courseTitle: input.courseTitle,
      sectionId: input.sectionId ?? null,
      jobIds: input.jobIds,
      labels: input.labels ?? {},
      status: "running",
    });
    refresh();
    return sessionId;
  }, [refresh]);

  const patchSession = useCallback(
    (
      sessionId: string,
      patch: Partial<
        Pick<
          ActivePdfBuildSession,
          "progressByJob" | "terminalByJob" | "labels" | "status"
        >
      >
    ) => {
      const current = loadPdfBuildSessions().find((s) => s.sessionId === sessionId);
      if (!current) return;
      upsertPdfBuildSession({ ...current, ...patch });
      refresh();
    },
    [refresh]
  );

  const updateJobProgress = useCallback(
    (sessionId: string, jobId: string, info: PdfBuildProgressUI) => {
      const current = loadPdfBuildSessions().find((s) => s.sessionId === sessionId);
      if (!current) return;
      patchSession(sessionId, {
        progressByJob: {
          ...current.progressByJob,
          [jobId]: { line: info.line, bar: info.bar },
        },
      });
    },
    [patchSession]
  );

  const updateJobTerminal = useCallback(
    (sessionId: string, jobId: string, outcome: { materialId?: string; error?: string }) => {
      const current = loadPdfBuildSessions().find((s) => s.sessionId === sessionId);
      if (!current) return;
      const terminalByJob = { ...current.terminalByJob, [jobId]: outcome };
      const n = current.jobIds.length;
      const terminals = current.jobIds.map((id) => terminalByJob[id]);
      const allDone = terminals.every((t) => t != null);
      let status: PdfBuildSessionStatus = current.status;
      if (allDone) {
        const ok = terminals.filter((t) => t?.materialId).length;
        const err = terminals.filter((t) => t?.error).length;
        status =
          err === 0 && ok > 0
            ? "success"
            : ok > 0
              ? "partial"
              : "failed";
      }
      patchSession(sessionId, { terminalByJob, status });
    },
    [patchSession]
  );

  const updateLabels = useCallback(
    (sessionId: string, labels: Record<string, string>) => {
      patchSession(sessionId, { labels });
    },
    [patchSession]
  );

  const markSessionStatus = useCallback(
    (sessionId: string, status: PdfBuildSessionStatus) => {
      patchSession(sessionId, { status });
    },
    [patchSession]
  );

  const ctx = useMemo(
    () => ({
      registerSession,
      updateJobProgress,
      updateJobTerminal,
      updateLabels,
      markSessionStatus,
    }),
    [
      registerSession,
      updateJobProgress,
      updateJobTerminal,
      updateLabels,
      markSessionStatus,
    ]
  );

  const search =
    typeof window !== "undefined" ? window.location.search : "";

  const runningSessions = sessions.filter((s) => s.status === "running");

  return (
    <ActivePdfBuildContext.Provider value={ctx}>
      {children}
      {runningSessions.map((session) =>
        session.jobIds.map((jobId) => {
          const skipTheater = isTheaterPageForSession(pathname, search, session);
          const terminal = session.terminalByJob[jobId];
          const skip = skipTheater || terminal != null;
          return (
            <BackgroundPdfJobPoll
              key={`${session.sessionId}-${jobId}`}
              session={session}
              jobId={jobId}
              skip={skip}
              onProgress={(id, info) => updateJobProgress(session.sessionId, id, info)}
              onDone={(id, outcome) => updateJobTerminal(session.sessionId, id, outcome)}
            />
          );
        })
      )}
      <ActivePdfBuildDock
        sessions={sessions.filter(
          (s) =>
            s.status === "running" ||
            s.status === "success" ||
            s.status === "partial" ||
            s.status === "failed"
        )}
        onDismiss={(id) => {
          dismissPdfBuildSession(id);
          refresh();
        }}
      />
    </ActivePdfBuildContext.Provider>
  );
}
