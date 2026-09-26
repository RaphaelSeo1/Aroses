"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActivePdfBuildOptional } from "@/components/ActivePdfBuildProvider";
import { buildSessionId } from "@/lib/active-pdf-builds";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { AppHeader } from "@/components/AppHeader";
import { CourseWorkspaceBackRow } from "@/components/CourseWorkspaceBackRow";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { LessonEditableBlocks } from "@/components/LessonEditableBlocks";
import { TranscriptReviewPanel } from "@/components/TranscriptReviewPanel";
import { TypewriterText } from "@/components/TypewriterText";
import type { SrsDueCounts } from "@/lib/srs-due";
import {
  pollPdfIngestJob,
  type PdfBuildProgressUI,
  type PollPdfIngestJobSnapshot,
} from "@/lib/pdf-ingest-client";
import { tryOutlinePreviewFromStreamTail } from "@/lib/pdf-ingest-preview";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import type { Dictionary } from "@/locales";
import type { CoursePayload } from "@/types/course";

type RowState = {
  label: string;
  line: string;
  bar: PdfBuildProgressUI["bar"];
  error?: string;
  materialId?: string;
};

type PollOutcome = { materialId?: string; error?: string };

/** True while the server is still expanding module bodies (not just outline). */
function modulesStillBuilding(
  snap: PollPdfIngestJobSnapshot | undefined
): boolean {
  if (!snap || snap.status !== "running") return false;
  if (snap.ingestPhase === "writing_modules") return true;
  if (!snap.outlineReady) return false;
  const total = snap.modulesTotal ?? 0;
  if (total <= 0) return false;
  const built =
    typeof snap.modulesBuilt === "number" ? snap.modulesBuilt : 0;
  return built < total;
}

const STOPPABLE_INGEST_PHASES = new Set([
  "planning_outline",
  "enriching_sources",
  "writing_modules",
]);

/** True while the user can stop generation (outline, sources, or module writing). */
function canStopPdfBuild(
  snap: PollPdfIngestJobSnapshot | undefined,
  terminal: PollOutcome | null | undefined
): boolean {
  if (terminal != null) return false;
  if (!snap || snap.status !== "running") return false;
  if (snap.ingestPhase && STOPPABLE_INGEST_PHASES.has(snap.ingestPhase)) {
    return true;
  }
  return modulesStillBuilding(snap);
}

function tabStatusLine(
  t: Dictionary["courseBuild"],
  terminal: PollOutcome | null | undefined,
  preview: CoursePayload | null | undefined,
  snap: PollPdfIngestJobSnapshot | undefined,
  phase: "boot" | "running" | "done",
  streamTail?: string | null
): { line: string; detail: string } {
  if (terminal?.error) {
    return { line: t.failed, detail: terminal.error };
  }
  if (terminal?.materialId) {
    return { line: t.done, detail: t.doneDetail };
  }
  if (snap?.ingestPhase === "enriching_sources") {
    return {
      line: t.enriching,
      detail: t.enrichingDetail,
    };
  }
  if (modulesStillBuilding(snap)) {
    return {
      line: t.writingModules,
      detail: t.writingModulesDetail,
    };
  }
  if (preview) {
    return {
      line: t.livePreview,
      detail: t.livePreviewDetail,
    };
  }
  if (
    snap?.ingestPhase === "planning_outline" &&
    typeof streamTail === "string" &&
    streamTail.length > 48
  ) {
    return {
      line: t.livePreview,
      detail: t.livePreviewStream,
    };
  }
  if (snap?.ingestPhase === "digesting_full_pdf") {
    return {
      line: t.preparingNotes,
      detail: t.preparingNotesDetail,
    };
  }
  if (snap?.ingestPhase === "planning_outline") {
    return {
      line: t.planningOutline,
      detail: t.planningOutlineDetail,
    };
  }
  if (snap?.ingestPhase === "reviewing_transcript") {
    return {
      line: t.reviewTranscript,
      detail: t.reviewTranscriptDetail,
    };
  }
  if (snap?.ingestPhase === "transcribing") {
    return {
      line: t.transcribing,
      detail: t.transcribingDetail,
    };
  }
  if (snap?.ingestPhase === "reading_pdf") {
    return {
      line: t.processingFiles,
      detail: t.processingFilesDetail,
    };
  }
  if (snap?.status === "pending") {
    return {
      line: t.queued,
      detail: t.queuedDetail,
    };
  }
  if (phase === "boot") {
    return { line: t.starting, detail: t.startingDetail };
  }
  if (snap) {
    return {
      line: t.extracting,
      detail: t.extractingDetail,
    };
  }
  return {
    line: t.sync,
    detail: t.waitingUpdate,
  };
}

function formatIsoLocal(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function PdfJobPoll({
  jobId,
  nonce,
  onProgress,
  onPreview,
  onJobSnapshot,
  onStreamPreview,
  onDone,
}: {
  jobId: string;
  nonce: number;
  onProgress: (id: string, info: PdfBuildProgressUI) => void;
  onPreview: (id: string, course: CoursePayload | null) => void;
  onJobSnapshot: (id: string, snap: PollPdfIngestJobSnapshot) => void;
  onStreamPreview?: (id: string, text: string | null) => void;
  onDone: (id: string, result: PollOutcome) => void;
}) {
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      const polled = await pollPdfIngestJob(
        jobId,
        (info) => {
          if (!ac.signal.aborted) onProgress(jobId, info);
        },
        {
          signal: ac.signal,
          onPreviewCourse: (course) => {
            if (!ac.signal.aborted) onPreview(jobId, course);
          },
          onJobSnapshot: (snap) => {
            if (!ac.signal.aborted) onJobSnapshot(jobId, snap);
          },
          onStreamPreview: onStreamPreview
            ? (text) => {
                if (!ac.signal.aborted) onStreamPreview(jobId, text);
              }
            : undefined,
        }
      );
      if (!ac.signal.aborted) onDone(jobId, polled);
    })();
    return () => ac.abort();
  }, [jobId, nonce, onProgress, onPreview, onJobSnapshot, onStreamPreview, onDone]);
  return null;
}

function StaggeredPdfJobPoll({
  index: _index,
  jobId,
  nonce,
  onProgress,
  onPreview,
  onJobSnapshot,
  onStreamPreview,
  onDone,
}: {
  index: number;
  jobId: string;
  nonce: number;
  onProgress: (id: string, info: PdfBuildProgressUI) => void;
  onPreview: (id: string, course: CoursePayload | null) => void;
  onJobSnapshot: (id: string, snap: PollPdfIngestJobSnapshot) => void;
  onStreamPreview?: (id: string, text: string | null) => void;
  onDone: (id: string, result: PollOutcome) => void;
}) {
  void _index;
  return (
    <PdfJobPoll
      jobId={jobId}
      nonce={nonce}
      onProgress={onProgress}
      onPreview={onPreview}
      onJobSnapshot={onJobSnapshot}
      onStreamPreview={onStreamPreview}
      onDone={onDone}
    />
  );
}

export function CourseBuildTheater({
  courseId,
  jobIds,
  sectionId,
  courseTitle,
  initialDueCounts,
}: {
  courseId: string;
  jobIds: string[];
  sectionId?: string | null;
  courseTitle: string;
  initialDueCounts?: SrsDueCounts;
}) {
  const t = useT();
  const router = useRouter();
  const pdfBuild = useActivePdfBuildOptional();
  const sessionIdRef = useRef(
    jobIds.length > 0 ? buildSessionId(courseId, jobIds) : ""
  );
  const [activeJob, setActiveJob] = useState(jobIds[0] ?? "");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [previewByJob, setPreviewByJob] = useState<
    Record<string, CoursePayload | null>
  >({});
  const [terminalByJob, setTerminalByJob] = useState<
    Record<string, PollOutcome | null>
  >(() => Object.fromEntries(jobIds.map((id) => [id, null])));
  const [restartNonce, setRestartNonce] = useState<Record<string, number>>(
    () => Object.fromEntries(jobIds.map((id) => [id, 0]))
  );
  const [phase, setPhase] = useState<"boot" | "running" | "done">("boot");
  const [summary, setSummary] = useState<"success" | "partial" | "fail" | null>(
    null
  );
  const [moduleIdx, setModuleIdx] = useState(0);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [pollStoppedByJob, setPollStoppedByJob] = useState<Record<string, boolean>>(
    {}
  );
  const [restartAckByJob, setRestartAckByJob] = useState<Record<string, string>>(
    {}
  );
  const [snapshotByJob, setSnapshotByJob] = useState<
    Record<string, PollPdfIngestJobSnapshot>
  >({});
  const [streamByJob, setStreamByJob] = useState<Record<string, string | null>>(
    {}
  );
  const [confirmedJobIds, setConfirmedJobIds] = useState<Record<string, boolean>>(
    {}
  );
  const confirmedJobIdsRef = useRef(confirmedJobIds);
  confirmedJobIdsRef.current = confirmedJobIds;

  const courseHome = `/dashboard/courses/${courseId}`;
  const courseHomeWithSection =
    sectionId && sectionId.length > 0
      ? `${courseHome}?section=${encodeURIComponent(sectionId)}`
      : courseHome;

  const goToStudyEditor = useCallback(
    (materialId: string) => {
      const u = `/dashboard/courses/${courseId}/study?material=${encodeURIComponent(materialId)}`;
      router.replace(u);
      router.refresh();
    },
    [router, courseId]
  );

  const goToCourseWorkspace = useCallback(() => {
    router.replace(courseHomeWithSection);
    router.refresh();
  }, [router, courseHomeWithSection]);

  useEffect(() => {
    if (!pdfBuild || jobIds.length === 0) return;
    sessionIdRef.current = pdfBuild.registerSession({
      courseId,
      courseTitle,
      sectionId,
      jobIds,
    });
  }, [pdfBuild, courseId, courseTitle, sectionId, jobIds]);

  useEffect(() => {
    if (!pdfBuild || !sessionIdRef.current) return;
    const labels: Record<string, string> = {};
    for (const id of jobIds) {
      const label = rows[id]?.label;
      if (label) labels[id] = label;
    }
    if (Object.keys(labels).length > 0) {
      pdfBuild.updateLabels(sessionIdRef.current, labels);
    }
  }, [pdfBuild, jobIds, rows]);

  const onProgress = useCallback((id: string, info: PdfBuildProgressUI) => {
    if (pdfBuild && sessionIdRef.current) {
      pdfBuild.updateJobProgress(sessionIdRef.current, id, info);
    }
    setRows((prev) => {
      const base = prev[id] ?? {
        label: t.courseBuild.pdfLabel,
        line: "",
        bar: "indeterminate" as const,
      };
      return {
        ...prev,
        [id]: {
          ...base,
          line: info.line,
          bar: info.bar,
        },
      };
    });
  }, [pdfBuild, t.courseBuild]);

  const onPreview = useCallback((id: string, course: CoursePayload | null) => {
    setPreviewByJob((prev) => ({ ...prev, [id]: course }));
  }, []);

  const onStreamTail = useCallback((id: string, text: string | null) => {
    setStreamByJob((prev) => ({ ...prev, [id]: text }));
    if (typeof text === "string" && text.length > 160) {
      const course = tryOutlinePreviewFromStreamTail(text);
      if (course) {
        setPreviewByJob((prev) => ({ ...prev, [id]: course }));
      }
    }
  }, []);

  const onJobSnapshot = useCallback(
    (id: string, snap: PollPdfIngestJobSnapshot) => {
      setSnapshotByJob((prev) => {
        const next =
          confirmedJobIdsRef.current[id] &&
          snap.ingestPhase === "reviewing_transcript"
            ? { ...snap, ingestPhase: "digesting_full_pdf" as const }
            : snap;
        return { ...prev, [id]: next };
      });
    },
    []
  );

  const onDone = useCallback((id: string, result: PollOutcome) => {
    if (pdfBuild && sessionIdRef.current) {
      pdfBuild.updateJobTerminal(sessionIdRef.current, id, result);
    }
    setTerminalByJob((prev) => ({ ...prev, [id]: result }));
    // Immediately update the status card for this job so it doesn't stay
    // stale while other jobs in the batch are still running.
    setRows((prev) => {
      const base = prev[id] ?? {
        label: t.courseBuild.pdfLabel,
        line: "",
        bar: "indeterminate" as const,
      };
      return {
        ...prev,
        [id]: {
          ...base,
          error: result.error,
          materialId: result.materialId,
          line: result.error
            ? result.error
            : result.materialId
              ? t.courseBuild.readyOpen
              : base.line,
          bar: result.materialId ? 100 : base.bar,
        },
      };
    });
  }, [pdfBuild, t.courseBuild]);

  useEffect(() => {
    if (!pdfBuild || !sessionIdRef.current) return;
    if (!jobIds.every((id) => terminalByJob[id] != null)) return;
    const ok = jobIds.some((id) => terminalByJob[id]?.materialId);
    const err = jobIds.some((id) => terminalByJob[id]?.error);
    pdfBuild.markSessionStatus(
      sessionIdRef.current,
      err && ok ? "partial" : err ? "failed" : "success"
    );
  }, [pdfBuild, jobIds, terminalByJob]);

  useEffect(() => {
    const t = setTimeout(() => {
      setActiveJob((prev) => (jobIds.includes(prev) ? prev : jobIds[0] ?? ""));
      setTerminalByJob(Object.fromEntries(jobIds.map((id) => [id, null])));
      setRestartNonce(Object.fromEntries(jobIds.map((id) => [id, 0])));
      setPhase("boot");
      setSummary(null);
      setRetryErr(null);
      setCancelErr(null);
      setPollStoppedByJob({});
      setRestartAckByJob({});
      setSnapshotByJob({});
      setStreamByJob({});
    }, 0);
    return () => clearTimeout(t);
  }, [jobIds]);

  // Kick the server-side worker once so module building self-heals even if this
  // tab is closed mid-build (the worker self-chains until all jobs finish).
  useEffect(() => {
    if (jobIds.length === 0) return;
    void fetch("/api/process-pdf/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depth: 0 }),
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  }, [jobIds]);

  useEffect(() => {
    if (jobIds.length === 0) return;

    const ac = new AbortController();

    const boot = async () => {
      const labelMap: Record<string, string> = {};
      await Promise.all(
        jobIds.map(async (id) => {
          try {
            const r = await fetch(`/api/process-pdf/jobs/${id}`, {
              signal: ac.signal,
            });
            const raw = await r.text();
            const j = JSON.parse(raw) as { originalFileName?: string };
            labelMap[id] =
              typeof j.originalFileName === "string" &&
              j.originalFileName.trim()
                ? j.originalFileName.trim()
                : t.courseBuild.pdfLabel;
          } catch {
            if (!ac.signal.aborted) labelMap[id] = t.courseBuild.pdfLabel;
          }
        })
      );
      if (ac.signal.aborted) return;

      setRows(
        Object.fromEntries(
          jobIds.map((id) => [
            id,
            {
              label: labelMap[id] ?? t.courseBuild.pdfLabel,
              line: t.courseBuild.starting,
              bar: "indeterminate" as const,
            },
          ])
        )
      );
      setPhase("running");
    };

    void boot();

    return () => {
      ac.abort();
    };
  }, [jobIds, t.courseBuild]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (phase !== "done" || summary !== "success") return;
    if (typeof document === "undefined" || !document.hidden) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const firstMaterial = jobIds
      .map((id) => terminalByJob[id]?.materialId)
      .find((m) => typeof m === "string" && m.length > 0);
    if (!firstMaterial) return;

    try {
      new Notification(t.courseBuild.notificationReady, {
        body: t.courseBuild.notificationBody,
        tag: `course-build-${courseId}`,
      });
    } catch {
      /* ignore */
    }
  }, [phase, summary, jobIds, terminalByJob, courseId, t.courseBuild]);

  useEffect(() => {
    if (jobIds.length === 0) return;
    if (!jobIds.every((id) => terminalByJob[id] != null)) return;

    let successTimer: ReturnType<typeof setTimeout> | undefined;

    const outcomes = jobIds.map((id) => ({
      id,
      polled: terminalByJob[id]!,
    }));

    const updateTimer = setTimeout(() => {
      setRows((prev) => {
        const next = { ...prev };
        for (const { id, polled } of outcomes) {
          const base = next[id] ?? {
            label: t.courseBuild.pdfLabel,
            line: "",
            bar: null as PdfBuildProgressUI["bar"],
          };
          next[id] = {
            ...base,
            error: polled.error,
            materialId: polled.materialId,
            line: polled.error
              ? polled.error
              : polled.materialId
                ? t.courseBuild.readyOpen
                : base.line,
            bar: polled.materialId ? 100 : base.bar,
          };
        }
        return next;
      });

      const okCount = outcomes.filter((o) => o.polled.materialId).length;
      const errCount = outcomes.filter((o) => o.polled.error).length;
      const s: "success" | "partial" | "fail" =
        errCount === 0 ? "success" : okCount > 0 ? "partial" : "fail";
      setSummary(s);
      setPhase("done");

      const firstMaterialInOrder = jobIds
        .map((id) => outcomes.find((o) => o.id === id)?.polled.materialId)
        .find((m) => typeof m === "string" && m.length > 0);

      if (s === "success" && firstMaterialInOrder) {
        successTimer = setTimeout(() => {
          goToStudyEditor(firstMaterialInOrder);
        }, 12_000);
      }
    }, 0);

    return () => {
      if (updateTimer) clearTimeout(updateTimer);
      if (successTimer) clearTimeout(successTimer);
    };
  }, [terminalByJob, jobIds, goToStudyEditor]);

  useEffect(() => {
    if (jobIds.length === 0) return;
    const anyInFlight = jobIds.some((id) => terminalByJob[id] == null);
    if (anyInFlight && phase === "done") {
      const t = setTimeout(() => {
        setPhase("running");
        setSummary(null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [terminalByJob, phase, jobIds]);

  useEffect(() => {
    const p = previewByJob[activeJob]?.modules;
    if (p && moduleIdx >= p.length) {
      const t = setTimeout(() => setModuleIdx(Math.max(0, p.length - 1)), 0);
      return () => clearTimeout(t);
    }
  }, [previewByJob, activeJob, moduleIdx]);

  async function cancelActiveJob() {
    const id = activeJob;
    if (!id) return;
    setCancelBusy(true);
    setCancelErr(null);
    try {
      const r = await fetch(`/api/process-pdf/jobs/${id}/cancel`, {
        method: "POST",
      });
      const raw = await r.text();
      if (!r.ok) {
        let msg = t.courseBuild.couldNotStop;
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (typeof j.error === "string" && j.error.trim()) msg = j.error.trim();
        } catch {
          /* ignore */
        }
        setCancelErr(msg);
        return;
      }
      const outcome: PollOutcome = { error: t.courseBuild.buildStopped };
      setPollStoppedByJob((p) => ({ ...p, [id]: true }));
      if (pdfBuild && sessionIdRef.current) {
        pdfBuild.updateJobTerminal(sessionIdRef.current, id, outcome);
      }
      setTerminalByJob((p) => ({ ...p, [id]: outcome }));
      setRows((p) => ({
        ...p,
        [id]: {
          ...(p[id] ?? {
            label: t.courseBuild.pdfLabel,
            line: "",
            bar: "indeterminate" as const,
          }),
          line: t.courseBuild.buildStopped,
          bar: null,
          error: outcome.error,
          materialId: undefined,
        },
      }));
      setPhase("done");
      setSummary("fail");
    } finally {
      setCancelBusy(false);
    }
  }

  async function retryActiveJob() {
    const id = activeJob;
    if (!id) return;
    setRetryBusy(true);
    setRetryErr(null);
    setCancelErr(null);
    try {
      const r = await fetch(`/api/process-pdf/jobs/${id}/retry`, {
        method: "POST",
      });
      const raw = await r.text();
      if (!r.ok) {
        let msg = t.courseBuild.couldNotRestart;
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (typeof j.error === "string" && j.error.trim()) msg = j.error.trim();
        } catch {
          /* ignore */
        }
        setRetryErr(msg);
        return;
      }
      try {
        const okBody = JSON.parse(raw) as { ok?: boolean; restartedAt?: string };
        if (okBody.ok === true && typeof okBody.restartedAt === "string") {
          const ts = okBody.restartedAt;
          setRestartAckByJob((p) => ({ ...p, [id]: ts }));
        }
      } catch {
        /* ignore */
      }
      const hintedTotal = previewByJob[id]?.modules?.length ?? 0;
      const restartLine =
        hintedTotal > 0
          ? tf(t.courseBuild.buildRestartedWithModules, { total: hintedTotal })
          : t.courseBuild.buildRestarted;
      setSnapshotByJob((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      setPreviewByJob((p) => ({ ...p, [id]: null }));
      setStreamByJob((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      setTerminalByJob((p) => ({ ...p, [id]: null }));
      setPollStoppedByJob((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      setRestartNonce((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
      setRows((p) => ({
        ...p,
        [id]: {
          ...(p[id] ?? {
            label: t.courseBuild.pdfLabel,
            line: "",
            bar: "indeterminate" as const,
          }),
          line: restartLine,
          bar: "indeterminate",
          error: undefined,
          materialId: undefined,
        },
      }));
    } finally {
      setRetryBusy(false);
    }
  }

  if (jobIds.length === 0) return null;

  const preview = previewByJob[activeJob];
  const row = rows[activeJob];
  const firstMaterialId = jobIds
    .map((id) => rows[id]?.materialId)
    .find((m) => typeof m === "string" && m.length > 0);
  const mod = preview?.modules[moduleIdx];

  const canOfferRetry =
    Boolean(row) &&
    !row.materialId &&
    (phase === "running" || (phase === "done" && summary !== "success"));

  const canOfferStop = canStopPdfBuild(
    snapshotByJob[activeJob],
    terminalByJob[activeJob]
  );

  return (
    <>
      {phase !== "boot"
        ? jobIds.map((id, index) =>
            pollStoppedByJob[id] ? null : (
              <StaggeredPdfJobPoll
                key={`${id}-${restartNonce[id] ?? 0}`}
                index={index}
                jobId={id}
                nonce={restartNonce[id] ?? 0}
                onProgress={onProgress}
                onPreview={onPreview}
                onJobSnapshot={onJobSnapshot}
                onStreamPreview={onStreamTail}
                onDone={onDone}
              />
            )
          )
        : null}
      <AppHeader right={<HeaderNavLoggedIn initialDueCounts={initialDueCounts} />} />
      <CourseWorkspaceBackRow courseId={courseId} courseTitle={courseTitle} />
      {phase === "running" ? (
        <div className="border-b border-zinc-200 bg-zinc-50/90 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-6">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {t.courseBuild.leavePageHint}
            </p>
            <button
              type="button"
              onClick={() => {
                router.push("/dashboard");
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {t.courseBuild.browseWhileBuilding}
            </button>
          </div>
        </div>
      ) : null}
      <main className="min-h-[calc(100vh-4rem)] bg-white dark:bg-zinc-950">
        <div
          className={`mx-auto px-4 pb-6 pt-1 sm:px-6 ${preview ? "max-w-6xl" : "max-w-4xl"}`}
        >
          {jobIds.length > 1 ? (
            <div className="mb-6 space-y-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t.courseBuild.tabsHint}
              </p>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.courseBuild.pdfBuildsAria}>
                {jobIds.map((id, idx) => {
                  const { line, detail } = tabStatusLine(
                    t.courseBuild,
                    terminalByJob[id],
                    previewByJob[id] ?? null,
                    snapshotByJob[id],
                    phase,
                    streamByJob[id] ?? null
                  );
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      title={detail}
                      aria-selected={id === activeJob}
                      onClick={() => {
                        setActiveJob(id);
                        setModuleIdx(0);
                        setRetryErr(null);
                        setCancelErr(null);
                      }}
                      className={`flex max-w-[min(100%,18rem)] flex-col items-start gap-0.5 rounded-2xl border px-3 py-2 text-left text-xs font-semibold transition ${
                        id === activeJob
                          ? "border-brand bg-brand text-white dark:border-brand dark:bg-brand"
                          : "border-zinc-200 bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      <span className="w-full truncate">
                        <span
                          className={
                            id === activeJob
                              ? "text-white/80"
                              : "text-zinc-500 dark:text-zinc-400"
                          }
                        >
                          {idx + 1}/{jobIds.length}
                        </span>{" "}
                        <span className="font-semibold">
                          {rows[id]?.label ?? t.courseBuild.pdfLabel}
                        </span>
                      </span>
                      <span
                        className={
                          id === activeJob
                            ? "text-[11px] font-medium text-white/90"
                            : "text-[11px] font-medium text-zinc-600 dark:text-zinc-300"
                        }
                      >
                        {line}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {row || preview ? (
            <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95 sm:-mx-6 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {preview ? (
                    <h1 className="text-base font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-lg">
                      <TypewriterText
                        text={preview.title}
                        instantBelow={0}
                        charDelayMs={28}
                        charsPerTick={2}
                      />
                    </h1>
                  ) : null}
                  {row ? (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        {row.label}
                      </p>
                      <p className="whitespace-pre-line text-sm text-zinc-800 dark:text-zinc-200">
                        {row.line}
                      </p>
                    </>
                  ) : null}
                  <AiStudyDisclaimer compact className="pt-0.5" />
                </div>
                {canOfferStop || canOfferRetry ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canOfferStop ? (
                      <button
                        type="button"
                        disabled={cancelBusy || retryBusy}
                        onClick={() => void cancelActiveJob()}
                        className="rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        {cancelBusy ? t.courseBuild.stopping : t.courseBuild.stop}
                      </button>
                    ) : null}
                    {canOfferRetry ? (
                      <button
                        type="button"
                        disabled={retryBusy || cancelBusy}
                        onClick={() => void retryActiveJob()}
                        className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {retryBusy ? t.courseBuild.restarting : t.courseBuild.restartPdf}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {cancelErr ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {cancelErr}
                </p>
              ) : null}
              {retryErr ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {retryErr}
                </p>
              ) : null}
              {restartAckByJob[activeJob] ? (
                <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300/90">
                  {tf(t.courseBuild.restartConfirmed, {
                    time: formatIsoLocal(restartAckByJob[activeJob]!),
                  })}
                </p>
              ) : null}
              {row ? (
                <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  {row.bar === "indeterminate" ? (
                    <div
                      className="absolute inset-y-0 w-[28%] rounded-full bg-brand/90 dark:bg-brand-soft animate-course-upload-indeterminate"
                      aria-hidden
                    />
                  ) : typeof row.bar === "number" ? (
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-300 dark:bg-brand-soft"
                      style={{
                        width: `${Math.max(2, Math.min(100, row.bar))}%`,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {preview && preview.modules.length > 1 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.modules.map((m, i) => {
                    const duplicateCount = preview.modules.filter(
                      (other) =>
                        other.title.trim().toLowerCase() ===
                        m.title.trim().toLowerCase()
                    ).length;
                    const dupIndex =
                      duplicateCount > 1
                        ? preview.modules
                            .slice(0, i + 1)
                            .filter(
                              (other) =>
                                other.title.trim().toLowerCase() ===
                                m.title.trim().toLowerCase()
                            ).length
                        : 0;
                    const label =
                      duplicateCount > 1 && dupIndex > 1
                        ? `${m.title} (${dupIndex})`
                        : m.title;
                    return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModuleIdx(i)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        i === moduleIdx
                          ? "bg-brand text-white dark:bg-brand"
                          : "border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <AiStudyDisclaimer className="mb-3" />
          )}

          {snapshotByJob[activeJob]?.ingestPhase === "reviewing_transcript" &&
          snapshotByJob[activeJob]?.ingestTranscript &&
          !confirmedJobIds[activeJob] ? (
            <div className="mb-8">
              <TranscriptReviewPanel
                jobId={activeJob}
                initialTranscript={snapshotByJob[activeJob]!.ingestTranscript!}
                onConfirmed={() => {
                  setConfirmedJobIds((prev) => ({
                    ...prev,
                    [activeJob]: true,
                  }));
                  setSnapshotByJob((prev) => {
                    const cur = prev[activeJob];
                    if (!cur) return prev;
                    return {
                      ...prev,
                      [activeJob]: {
                        ...cur,
                        ingestPhase: "digesting_full_pdf",
                      },
                    };
                  });
                  void fetch("/api/process-pdf/expand", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      jobId: activeJob,
                      resumeTranscript: true,
                    }),
                  }).catch(() => {});
                }}
              />
            </div>
          ) : null}

          {!preview ? (
            (streamByJob[activeJob]?.length ?? 0) > 40 ? (
              <div className="flex min-h-[40vh] flex-col gap-6 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-6 py-12 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                    {t.courseBuild.buildingCourseEyebrow}
                  </p>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {t.courseBuild.outlineStreamingBody}
                  </p>
                </div>
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-10 animate-pulse rounded-lg bg-zinc-200/90 dark:bg-zinc-800/80"
                      style={{ width: `${62 + (i % 3) * 12}%` }}
                    />
                  ))}
                </div>
              </div>
            ) : (
            <div className="flex min-h-[22vh] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {jobIds.length > 1
                  ? tf(t.courseBuild.noLayoutYet, {
                      label: row?.label ?? t.courseBuild.pdfLabel,
                    })
                  : t.courseBuild.blankPage}
              </p>
              <p className="mt-2 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
                {jobIds.length > 1 ? t.courseBuild.parallelHint : t.courseBuild.titlesFillIn}
              </p>
            </div>
            )
          ) : (
            <div className="space-y-6">
              {preview.description?.trim() ? (
                <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <TypewriterText
                    text={preview.description}
                    mode="words"
                    wordDelayMs={36}
                    instantBelow={0}
                  />
                </p>
              ) : null}

              {mod ? (
                <section className="space-y-6">
                  <header>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                      {tf(t.courseBuild.moduleN, { id: mod.id })}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      <TypewriterText
                        text={mod.title}
                        instantBelow={0}
                        charDelayMs={28}
                        charsPerTick={2}
                      />
                    </h2>
                  </header>

                  <div className="space-y-10">
                    {mod.lessons.map((lesson, li) => (
                      <div key={`${mod.id}-${li}`} className="scroll-mt-24">
                        <LessonEditableBlocks
                          materialId={
                            rows[activeJob]?.materialId ??
                            firstMaterialId ??
                            "__live_build__"
                          }
                          moduleId={mod.id}
                          lessonIndex={li}
                          lesson={lesson}
                          readOnly
                          animateReveal
                          compactBuild
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}

          {phase === "done" && summary === "success" && typeof firstMaterialId === "string" ? (
            <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-8 dark:border-zinc-800">
              <Link
                href={`/dashboard/courses/${courseId}/study?material=${encodeURIComponent(firstMaterialId)}`}
                className="inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
              >
                {t.courseBuild.openInEditor}
              </Link>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {t.courseBuild.openingEditorSoon}
              </span>
            </div>
          ) : null}

          {phase === "done" && summary !== "success" ? (
            <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-8 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => goToCourseWorkspace()}
                className="inline-flex rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {summary === "partial"
                  ? t.courseBuild.dismissAndGo
                  : t.courseBuild.dismiss}
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
