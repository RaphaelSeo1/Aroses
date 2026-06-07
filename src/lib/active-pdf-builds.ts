/**
 * Persist in-flight PDF course builds so polling can continue after the user
 * leaves the build theater page.
 */

export type PdfBuildSessionStatus = "running" | "success" | "partial" | "failed";

export type ActivePdfBuildSession = {
  /** Stable key: courseId + sorted job ids */
  sessionId: string;
  courseId: string;
  courseTitle: string;
  sectionId?: string | null;
  jobIds: string[];
  labels: Record<string, string>;
  startedAt: string;
  status: PdfBuildSessionStatus;
  /** Per-job progress line from the poll loop */
  progressByJob: Record<string, { line: string; bar: number | "indeterminate" | null }>;
  /** Terminal outcomes once each job finishes */
  terminalByJob: Record<
    string,
    { materialId?: string; error?: string } | null | undefined
  >;
  dismissedAt?: string;
};

const STORAGE_KEY = "rose:activePdfBuildSessions";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function buildSessionId(courseId: string, jobIds: string[]): string {
  return `${courseId}:${[...jobIds].sort().join(",")}`;
}

export function loadPdfBuildSessions(): ActivePdfBuildSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((s): s is ActivePdfBuildSession => {
        if (!s || typeof s !== "object") return false;
        const o = s as ActivePdfBuildSession;
        if (typeof o.sessionId !== "string" || typeof o.courseId !== "string") {
          return false;
        }
        const started = Date.parse(o.startedAt);
        if (Number.isFinite(started) && now - started > MAX_AGE_MS) return false;
        if (o.dismissedAt) return false;
        return true;
      })
      .map((s) => ({
        ...s,
        progressByJob: s.progressByJob ?? {},
        terminalByJob: s.terminalByJob ?? {},
        labels: s.labels ?? {},
      }));
  } catch {
    return [];
  }
}

export function savePdfBuildSessions(sessions: ActivePdfBuildSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    window.dispatchEvent(new CustomEvent("rose:pdf-build-sessions"));
  } catch {
    /* quota / private mode */
  }
}

export function upsertPdfBuildSession(
  patch: Omit<
    ActivePdfBuildSession,
    "progressByJob" | "terminalByJob" | "status" | "startedAt"
  > & {
    progressByJob?: ActivePdfBuildSession["progressByJob"];
    terminalByJob?: ActivePdfBuildSession["terminalByJob"];
    status?: PdfBuildSessionStatus;
    startedAt?: string;
  }
): ActivePdfBuildSession {
  const sessions = loadPdfBuildSessions();
  const idx = sessions.findIndex((s) => s.sessionId === patch.sessionId);
  const prev = idx >= 0 ? sessions[idx] : null;
  const next: ActivePdfBuildSession = {
    sessionId: patch.sessionId,
    courseId: patch.courseId,
    courseTitle: patch.courseTitle,
    sectionId: patch.sectionId ?? null,
    jobIds: patch.jobIds,
    labels: patch.labels ?? prev?.labels ?? {},
    startedAt: patch.startedAt ?? prev?.startedAt ?? new Date().toISOString(),
    status: patch.status ?? prev?.status ?? "running",
    progressByJob: { ...prev?.progressByJob, ...patch.progressByJob },
    terminalByJob: { ...prev?.terminalByJob, ...patch.terminalByJob },
  };
  if (idx >= 0) sessions[idx] = next;
  else sessions.push(next);
  savePdfBuildSessions(sessions);
  return next;
}

export function dismissPdfBuildSession(sessionId: string): void {
  const sessions = loadPdfBuildSessions().filter((s) => s.sessionId !== sessionId);
  savePdfBuildSessions(sessions);
}

export function sessionBuildHref(session: ActivePdfBuildSession): string {
  const qs = new URLSearchParams();
  qs.set("pdfJobs", session.jobIds.join(","));
  if (session.sectionId) qs.set("section", session.sectionId);
  return `/dashboard/courses/${session.courseId}/study/build?${qs.toString()}`;
}

export function isTheaterPageForSession(
  pathname: string,
  search: string,
  session: ActivePdfBuildSession
): boolean {
  const prefix = `/dashboard/courses/${session.courseId}/study/build`;
  if (!pathname.startsWith(prefix)) return false;
  const params = new URLSearchParams(search);
  const raw = params.get("pdfJobs") ?? "";
  const onPage = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return session.jobIds.every((id) => onPage.has(id));
}

export function summarizeSession(session: ActivePdfBuildSession): {
  headline: string;
  detail: string;
  bar: number | "indeterminate" | null;
} {
  const n = session.jobIds.length;
  const terminals = session.jobIds.map((id) => session.terminalByJob[id]);
  const doneCount = terminals.filter((t) => t != null).length;
  const okCount = terminals.filter((t) => t?.materialId).length;
  const errCount = terminals.filter((t) => t?.error).length;

  if (session.status === "success" || (doneCount === n && errCount === 0 && okCount > 0)) {
    return {
      headline: "Course ready",
      detail:
        n === 1
          ? session.labels[session.jobIds[0]!] ?? session.courseTitle
          : `${okCount} of ${n} files ready`,
      bar: 100,
    };
  }
  if (session.status === "failed" || (doneCount === n && okCount === 0)) {
    return {
      headline: "Build failed",
      detail: terminals.find((t) => t?.error)?.error ?? "Try Restart on the build page.",
      bar: null,
    };
  }
  if (session.status === "partial" || (doneCount === n && errCount > 0)) {
    return {
      headline: "Build finished with errors",
      detail: `${okCount} succeeded, ${errCount} failed`,
      bar: Math.round((okCount / n) * 100),
    };
  }

  const lines = session.jobIds
    .map((id) => session.progressByJob[id]?.line)
    .filter((l): l is string => Boolean(l && l.trim()));
  const detail =
    lines.length === 1
      ? lines[0]!
      : lines.length > 1
        ? `${doneCount}/${n} files done · ${lines[lines.length - 1]}`
        : n === 1
          ? session.labels[session.jobIds[0]!] ?? "Your PDF"
          : `Building ${n} files…`;

  let bar: number | "indeterminate" | null = "indeterminate";
  const bars = session.jobIds
    .map((id) => session.progressByJob[id]?.bar)
    .filter((b): b is number => typeof b === "number");
  if (bars.length > 0) {
    bar = Math.round(bars.reduce((a, b) => a + b, 0) / bars.length);
  } else if (n > 0 && doneCount > 0) {
    bar = Math.round((doneCount / n) * 100);
  }

  return {
    headline: "Course generating…",
    detail,
    bar,
  };
}
