"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

function tabStatusLine(
  terminal: PollOutcome | null | undefined,
  preview: CoursePayload | null | undefined,
  snap: PollPdfIngestJobSnapshot | undefined,
  phase: "boot" | "running" | "done",
  streamTail?: string | null
): { line: string; detail: string } {
  if (terminal?.error) {
    return { line: "Failed", detail: terminal.error };
  }
  if (terminal?.materialId) {
    return { line: "Done", detail: "Open in study editor from the course list." };
  }
  // IMPORTANT: check module progress before `preview`. The merged preview
  // exists as soon as the outline is saved, but modules can still be writing
  // for minutes — tabs must not all jump to "Live preview" during that time.
  if (modulesStillBuilding(snap)) {
    return {
      line: "Writing modules…",
      detail:
        "Outline is on screen; lesson bodies are still being generated for this PDF.",
    };
  }
  if (preview) {
    return {
      line: "Live preview",
      detail:
        "Outline is visible; lessons fill in as each module finishes (order can differ from other PDFs in this batch).",
    };
  }
  if (
    snap?.ingestPhase === "planning_outline" &&
    typeof streamTail === "string" &&
    streamTail.length > 48
  ) {
    return {
      line: "Live preview",
      detail:
        "Outline JSON is streaming from the model — the layout appears as soon as we can parse it.",
    };
  }
  if (snap?.ingestPhase === "planning_outline") {
    return {
      line: "Planning outline…",
      detail:
        "Step 2/2: the model is drafting the course outline (JSON). Large slide decks can take several minutes.",
    };
  }
  if (snap?.ingestPhase === "reviewing_transcript") {
    return {
      line: "Review transcript",
      detail:
        "Fix transcription errors below, then continue to course generation.",
    };
  }
  if (snap?.ingestPhase === "transcribing") {
    return {
      line: "Transcribing…",
      detail:
        "Speech-to-text can take several minutes for long recordings.",
    };
  }
  if (snap?.ingestPhase === "reading_pdf") {
    return {
      line: "Processing files…",
      detail:
        "Step 1/2: extracting text from documents, slides, images, or transcribing media.",
    };
  }
  if (snap?.status === "pending") {
    return {
      line: "Queued…",
      detail:
        "This build starts shortly after upload. In large batches the first few PDFs start a few seconds apart (capped), then the rest kick in together so the tab strip does not stay idle too long.",
    };
  }
  if (phase === "boot") {
    return { line: "Starting…", detail: "Loading file names and job state." };
  }
  if (snap) {
    return {
      line: "Extracting…",
      detail:
        "Step 1/2: reading PDF text. Long slide decks prioritize the start and end of the file so you see progress faster.",
    };
  }
  return {
    line: "Syncing…",
    detail: "Waiting for the first status update from the server.",
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
  const router = useRouter();
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
  const [restartAckByJob, setRestartAckByJob] = useState<Record<string, string>>(
    {}
  );
  const [snapshotByJob, setSnapshotByJob] = useState<
    Record<string, PollPdfIngestJobSnapshot>
  >({});
  const [streamByJob, setStreamByJob] = useState<Record<string, string | null>>(
    {}
  );

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

  const onProgress = useCallback((id: string, info: PdfBuildProgressUI) => {
    setRows((prev) => {
      const base = prev[id] ?? {
        label: "PDF",
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
  }, []);

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
      setSnapshotByJob((prev) => ({ ...prev, [id]: snap }));
    },
    []
  );

  const onDone = useCallback((id: string, result: PollOutcome) => {
    setTerminalByJob((prev) => ({ ...prev, [id]: result }));
    // Immediately update the status card for this job so it doesn't stay
    // stale while other jobs in the batch are still running.
    setRows((prev) => {
      const base = prev[id] ?? { label: "PDF", line: "", bar: "indeterminate" as const };
      return {
        ...prev,
        [id]: {
          ...base,
          error: result.error,
          materialId: result.materialId,
          line: result.error
            ? result.error
            : result.materialId
              ? "Ready — open study mode below."
              : base.line,
          bar: result.materialId ? 100 : base.bar,
        },
      };
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setActiveJob((prev) => (jobIds.includes(prev) ? prev : jobIds[0] ?? ""));
      setTerminalByJob(Object.fromEntries(jobIds.map((id) => [id, null])));
      setRestartNonce(Object.fromEntries(jobIds.map((id) => [id, 0])));
      setPhase("boot");
      setSummary(null);
      setRetryErr(null);
      setRestartAckByJob({});
      setSnapshotByJob({});
      setStreamByJob({});
    }, 0);
    return () => clearTimeout(t);
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
                : "PDF";
          } catch {
            if (!ac.signal.aborted) labelMap[id] = "PDF";
          }
        })
      );
      if (ac.signal.aborted) return;

      setRows(
        Object.fromEntries(
          jobIds.map((id) => [
            id,
            {
              label: labelMap[id] ?? "PDF",
              line: "Starting…",
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
  }, [jobIds]);

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
      new Notification("Your course is ready", {
        body: "Open Aroses to start studying.",
        tag: `course-build-${courseId}`,
      });
    } catch {
      /* ignore */
    }
  }, [phase, summary, jobIds, terminalByJob, courseId]);

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
            label: "PDF",
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
                ? "Ready — open study mode below."
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

  async function retryActiveJob() {
    const id = activeJob;
    if (!id) return;
    setRetryBusy(true);
    setRetryErr(null);
    try {
      const r = await fetch(`/api/process-pdf/jobs/${id}/retry`, {
        method: "POST",
      });
      const raw = await r.text();
      if (!r.ok) {
        let msg = "Could not restart this build.";
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
          ? `Build restarted — next: module 1 of ${hintedTotal} (this count is from your last preview; the new outline can change it).`
          : "Build restarted — starting again from step 1 (extract → outline → modules)…";
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
      setRestartNonce((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
      setRows((p) => ({
        ...p,
        [id]: {
          ...(p[id] ?? { label: "PDF", line: "", bar: "indeterminate" as const }),
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

  return (
    <>
      {phase !== "boot"
        ? jobIds.map((id, index) => (
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
          ))
        : null}
      <AppHeader right={<HeaderNavLoggedIn initialDueCounts={initialDueCounts} />} />
      <CourseWorkspaceBackRow courseId={courseId} courseTitle={courseTitle} />
      <main className="min-h-[calc(100vh-4rem)] bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-10">
          <AiStudyDisclaimer className="mb-6" />

          {jobIds.length > 1 ? (
            <div className="mb-6 space-y-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Tabs stay in the order you uploaded. Each PDF finishes on its own
                schedule, so previews can appear in a different order than the list
                — use the status under each name to see which step each file is on.
                All jobs poll in parallel so previews can land as soon as the server has
                anything to show.
              </p>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="PDF builds">
                {jobIds.map((id, idx) => {
                  const { line, detail } = tabStatusLine(
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
                          {rows[id]?.label ?? "PDF"}
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

          {row ? (
            <div className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    {row.label}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-zinc-800 dark:text-zinc-200">
                    {row.line}
                  </p>
                </div>
                {canOfferRetry ? (
                  <button
                    type="button"
                    disabled={retryBusy}
                    onClick={() => void retryActiveJob()}
                    className="shrink-0 rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {retryBusy ? "Restarting…" : "Restart this PDF"}
                  </button>
                ) : null}
              </div>
              {retryErr ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {retryErr}
                </p>
              ) : null}
              {restartAckByJob[activeJob] ? (
                <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300/90">
                  Restart confirmed at{" "}
                  {formatIsoLocal(restartAckByJob[activeJob]!)}. This upload is
                  building again from the start — you will see fresh progress in
                  the status line above.
                </p>
              ) : null}
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
            </div>
          ) : null}

          {snapshotByJob[activeJob]?.ingestPhase === "reviewing_transcript" &&
          snapshotByJob[activeJob]?.ingestTranscript ? (
            <div className="mb-8">
              <TranscriptReviewPanel
                jobId={activeJob}
                initialTranscript={snapshotByJob[activeJob]!.ingestTranscript!}
              />
            </div>
          ) : null}

          {!preview ? (
            (streamByJob[activeJob]?.length ?? 0) > 40 ? (
              <div className="flex min-h-[40vh] flex-col gap-6 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-6 py-12 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                    Building your course
                  </p>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    Outline JSON is arriving from the model. The full layout appears
                    here as soon as we can parse it — nothing is wrong while you see
                    this skeleton.
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
            <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {jobIds.length > 1
                  ? `No live layout yet for “${row?.label ?? "this PDF"}”.`
                  : "Blank page — your course will fill in here as soon as the outline is ready."}
              </p>
              <p className="mt-2 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
                {jobIds.length > 1 ? (
                  <>
                    Extraction and outline work complete in parallel across your
                    uploads, so another tab can show a preview while this file is
                    still reading pages. The status line above matches this PDF only;
                    switch tabs to watch others.
                  </>
                ) : (
                  <>
                    Titles, lessons, key terms, and examples appear in the same layout
                    as study mode, updated as each part finishes generating.
                  </>
                )}
              </p>
            </div>
            )
          ) : (
            <div className="space-y-10">
              <header className="border-b border-zinc-100 pb-8 dark:border-zinc-900">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  <TypewriterText
                    text={preview.title}
                    instantBelow={0}
                    charDelayMs={42}
                    charsPerTick={1}
                  />
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <TypewriterText
                    text={preview.description}
                    mode="words"
                    wordDelayMs={48}
                    instantBelow={0}
                  />
                </p>
              </header>

              {preview.modules.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {preview.modules.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModuleIdx(i)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        i === moduleIdx
                          ? "bg-brand text-white dark:bg-brand"
                          : "border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                      }`}
                    >
                      {m.title}
                    </button>
                  ))}
                </div>
              ) : null}

              {mod ? (
                <section className="space-y-10">
                  <header className="border-b border-zinc-100 pb-6 dark:border-zinc-900">
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                      Module {mod.id}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      <TypewriterText
                        text={mod.title}
                        instantBelow={0}
                        charDelayMs={42}
                        charsPerTick={1}
                      />
                    </h2>
                  </header>

                  <div className="space-y-14">
                    {mod.lessons.map((lesson, li) => (
                      <div key={`${mod.id}-${li}`} className="scroll-mt-24">
                        <LessonEditableBlocks
                          materialId="__live_build__"
                          moduleId={mod.id}
                          lessonIndex={li}
                          lesson={lesson}
                          readOnly
                          animateReveal
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
                Open in editor
              </Link>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Opening the study editor in a few seconds (you can use the button
                now)…
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
                {summary === "partial" ? "Dismiss & go to course" : "Dismiss"}
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
