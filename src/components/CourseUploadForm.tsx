"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  describePdfIngestUploadFailure,
} from "@/lib/storage-upload-errors";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import type { PdfBuildProgressUI } from "@/lib/pdf-ingest-client";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import {
  describeIngestFile,
  INGEST_SIZE_HINT,
  validateIngestBatch,
} from "@/lib/study-ingest/validate";
import {
  estimatedProcessingHint,
  formatLabel,
  INGEST_ACCEPT_ATTRIBUTE,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKindIcon(kind: IngestFormatKind): string {
  switch (kind) {
    case "pdf":
    case "word":
    case "text":
    case "markdown":
    case "rtf":
      return "📄";
    case "slides":
      return "📊";
    case "image":
      return "🖼";
    case "audio":
      return "🎧";
    case "video":
      return "🎬";
    default:
      return "📎";
  }
}

/** Prefer API `{ error: string }`; otherwise explain status / body so we never hide gateway/HTML failures. */
function messageFromUploadResponse(res: Response, rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    /* not JSON */
  }

  if (res.status === 413) {
    return "File is too large for the server. Try a smaller PDF or split the document.";
  }
  if (res.status === 401) {
    return "Session expired. Sign in again and retry.";
  }
  if (res.status === 408 || res.status === 504) {
    return "Request timed out. Try a smaller PDF or upload again in a moment.";
  }

  const trimmed = rawBody.trim().replace(/\s+/g, " ");
  const looksLikeHtml =
    trimmed.startsWith("<!") ||
    trimmed.startsWith("<html") ||
    trimmed.toLowerCase().includes("<head");
  const noUsefulBody = trimmed.length === 0 || looksLikeHtml;

  if (
    noUsefulBody &&
    (res.status === 500 || res.status === 502 || res.status === 503)
  ) {
    return `Upload failed (${res.status}): the server stopped before sending a proper response. Check your host logs, confirm ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY on production, and that migrations 020 and 021 (pdf ingest) are applied in Supabase.`;
  }

  if (trimmed.length > 0 && !looksLikeHtml && trimmed.length < 400) {
    return `${res.status} ${res.statusText}: ${trimmed}`;
  }

  return `Request failed (${res.status} ${res.statusText || "error"}). Try a smaller file or retry later.`;
}

export function CourseUploadForm({
  courseId,
  examGroupId,
  /** Self-study courses expand the per-upload goal block by default so the
   *  learner is nudged to write a goal specific to *this* lecture. The
   *  textarea always starts blank — goals are no longer course-wide. */
  isSelfStudy = false,
}: {
  courseId: string;
  examGroupId: string;
  isSelfStudy?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Per-upload study goal. Always starts blank — every upload deserves its
  // own focus statement, not a stale course-wide one. For self-study courses
  // we open the block by default so the learner remembers to fill it in.
  const [studyGoal, setStudyGoal] = useState<string>("");
  const [showGoal, setShowGoal] = useState<boolean>(isSelfStudy);
  const [polishingGoal, setPolishingGoal] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [buildProgress, setBuildProgress] = useState<PdfBuildProgressUI | null>(
    null
  );
  const [dragOver, setDragOver] = useState(false);
  const [fileMeta, setFileMeta] = useState<
    Record<string, { durationSec?: number; hint?: string }>
  >({});

  const fileKey = (f: File) => `${f.name}:${f.size}`;

  useEffect(() => {
    let cancelled = false;
    const next: Record<string, { durationSec?: number; hint?: string }> = {};
    void (async () => {
      for (const f of files) {
        const d = describeIngestFile(f);
        const key = fileKey(f);
        if (!d) continue;
        next[key] = { hint: estimatedProcessingHint(d.kind) };
        if (d.kind === "audio" || d.kind === "video") {
          const url = URL.createObjectURL(f);
          try {
            const el = document.createElement(
              d.kind === "video" ? "video" : "audio"
            );
            el.preload = "metadata";
            el.src = url;
            await new Promise<void>((resolve, reject) => {
              el.onloadedmetadata = () => resolve();
              el.onerror = () => reject(new Error("metadata"));
            });
            if (!cancelled && Number.isFinite(el.duration)) {
              next[key] = {
                ...next[key],
                durationSec: el.duration,
              };
            }
          } catch {
            /* ignore */
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
      if (!cancelled) setFileMeta(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [files]);

  /**
   * Rewrite the per-upload goal into a tight one-liner using the same
   * /api/self-study/polish-goal endpoint the course creation form uses.
   * Updates the textarea in-place so the user can still tweak afterwards.
   */
  const polishGoalInPlace = useCallback(async () => {
    const raw = studyGoal.trim();
    if (!raw) {
      setGoalError("Type your goal first, then polish it.");
      return;
    }
    setGoalError(null);
    setPolishingGoal(true);
    try {
      const res = await fetch("/api/self-study/polish-goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_context: raw }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
      };
      if (!res.ok || typeof body.summary !== "string") {
        setGoalError(
          typeof body.error === "string"
            ? body.error
            : "Couldn't polish — try editing manually."
        );
        return;
      }
      setStudyGoal(body.summary.trim());
    } catch {
      setGoalError("Network error while polishing.");
    } finally {
      setPolishingGoal(false);
    }
  }, [studyGoal]);

  const addIngestFiles = useCallback(
    (list: FileList | File[] | null | undefined) => {
      const incoming = Array.from(list ?? []);
      const accepted: File[] = [];
      const rejected: string[] = [];
      for (const f of incoming) {
        if (describeIngestFile(f)) accepted.push(f);
        else rejected.push(f.name);
      }
      if (accepted.length === 0) {
        setError(
          rejected.length > 0
            ? `Unsupported file type${rejected.length > 1 ? "s" : ""}: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? "…" : ""}. Try PDF, Word, slides, text, images, audio, or video.`
            : "Choose a supported file type."
        );
        return;
      }
      if (rejected.length > 0) {
        setError(
          `${rejected.length} unsupported file(s) skipped. Supported: PDF, Word, PowerPoint, text, images, audio, video.`
        );
      } else {
        setError(null);
      }
      setSuccess(null);
      setFiles((prev) => {
        const next = [...prev];
        for (const f of accepted) {
          const dup = next.some((x) => x.name === f.name && x.size === f.size);
          if (!dup) next.push(f);
        }
        return next;
      });
    },
    []
  );

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
    setSuccess(null);
  }

  // Drag-to-reorder state for the pending-file list.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const previewFiles = useMemo(() => {
    if (dragFrom === null || dragOverIdx === null || dragFrom === dragOverIdx) {
      return files;
    }
    const next = [...files];
    const [removed] = next.splice(dragFrom, 1);
    next.splice(dragOverIdx, 0, removed);
    return next;
  }, [files, dragFrom, dragOverIdx]);

  function handleFileDragStart(e: React.DragEvent, index: number) {
    if (loading) return;
    setDragFrom(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleFileDragOver(e: React.DragEvent, index: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) setDragOverIdx(index);
  }

  function handleFileDrop(e: React.DragEvent, toIndex: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (dragFrom !== toIndex) {
      setFiles((prev) => {
        const next = [...prev];
        const [removed] = next.splice(dragFrom, 1);
        next.splice(toIndex, 0, removed);
        return next;
      });
    }
    setDragFrom(null);
    setDragOverIdx(null);
  }

  function handleFileDragEnd() {
    setDragFrom(null);
    setDragOverIdx(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!examGroupId) {
      setError("Select a section first.");
      return;
    }
    if (files.length === 0) {
      setError("Choose or drop at least one file.");
      return;
    }

    const descriptors = files
      .map((f) => describeIngestFile(f))
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const batchErr = validateIngestBatch(descriptors);
    if (batchErr) {
      setError(batchErr);
      return;
    }

    setLoading(true);
    setBuildProgress({
      line:
        files.length > 1
          ? `Uploading ${files.length} files…`
          : `${files[0].name} — Uploading…`,
      bar: "indeterminate",
    });

    const uploadedPaths: string[] = [];

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Session expired. Sign in again and retry.");
        setLoading(false);
        return;
      }

      const userId = user.id;

      // Validate + resolve a storage path for every file first (fail fast on an
      // unsupported format before we start uploading anything).
      type PreparedUpload = {
        file: File;
        pathInfo: NonNullable<ReturnType<typeof ingestStoragePathForFile>>;
      };
      const prepared: PreparedUpload[] = [];
      for (const file of files) {
        const pathInfo = ingestStoragePathForFile(userId, file);
        if (!pathInfo) {
          setError(`${file.name}: unsupported format.`);
          setLoading(false);
          return;
        }
        prepared.push({ file, pathInfo });
      }

      // Upload all files to storage in parallel so they land together instead
      // of counting up one-by-one.
      type UploadResult = {
        storagePath: string;
        originalFileName: string;
        error?: string;
      };
      const uploadResults: UploadResult[] = await Promise.all(
        prepared.map(async ({ file, pathInfo }): Promise<UploadResult> => {
          const { error: upErr } = await supabase.storage
            .from(STUDY_PDF_INGEST_BUCKET)
            .upload(pathInfo.storagePath, file, {
              contentType: pathInfo.contentType,
              cacheControl: "3600",
              upsert: false,
            });
          if (upErr) {
            const detail =
              typeof upErr === "object" && upErr && "message" in upErr
                ? String((upErr as { message: unknown }).message)
                : String(upErr);
            return {
              storagePath: pathInfo.storagePath,
              originalFileName: file.name,
              error: describePdfIngestUploadFailure(detail),
            };
          }
          return {
            storagePath: pathInfo.storagePath,
            originalFileName: file.name,
          };
        })
      );

      // Track everything that actually landed so we can clean up on failure.
      for (const r of uploadResults) {
        if (!r.error) uploadedPaths.push(r.storagePath);
      }

      const uploadFailure = uploadResults.find((r) => r.error);
      if (uploadFailure) {
        await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .remove(uploadedPaths)
          .catch(() => {});
        setError(
          `${uploadFailure.originalFileName}: ${uploadFailure.error}`
        );
        setLoading(false);
        return;
      }

      const apiFiles = uploadResults.map((r) => ({
        storagePath: r.storagePath,
        originalFileName: r.originalFileName,
      }));

      setBuildProgress({
        line:
          apiFiles.length > 1
            ? `Starting ${apiFiles.length} course builds…`
            : "Starting course build…",
        bar: "indeterminate",
      });

      // One build per file, kicked off in parallel so all jobs are created at
      // once and the build page opens with every tab building simultaneously.
      type StartOutcome = {
        file: { originalFileName: string };
        jobId?: string;
        materialId?: string;
        error?: string;
      };
      const startOutcomes: StartOutcome[] = await Promise.all(
        apiFiles.map(async (f): Promise<StartOutcome> => {
          try {
            const res = await fetch("/api/process-pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                courseId,
                examGroupId,
                files: [f],
                studyContext: studyGoal.trim() || undefined,
              }),
            });
            const raw = await res.text();
            if (!res.ok) {
              return { file: f, error: messageFromUploadResponse(res, raw) };
            }
            const body = JSON.parse(raw) as {
              materialId?: string;
              jobId?: string;
            };
            return {
              file: f,
              jobId: typeof body.jobId === "string" ? body.jobId : undefined,
              materialId:
                typeof body.materialId === "string" ? body.materialId : undefined,
            };
          } catch {
            return { file: f, error: "Network error while starting build." };
          }
        })
      );

      // Preserve upload order so tab numbering matches the file list.
      const jobIds = startOutcomes
        .map((o) => o.jobId)
        .filter((id): id is string => Boolean(id));
      const firstMaterialId =
        startOutcomes.find((o) => o.materialId)?.materialId ?? null;
      const failure = startOutcomes.find((o) => o.error);

      if (failure && jobIds.length === 0 && !firstMaterialId) {
        await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .remove(uploadedPaths)
          .catch(() => {});
        setError(`${failure.file.originalFileName}: ${failure.error}`);
        setLoading(false);
        return;
      }

      setBuildProgress(null);
      setFiles([]);

      if (jobIds.length > 0) {
        const qs = new URLSearchParams();
        qs.set("pdfJobs", jobIds.join(","));
        qs.set("section", examGroupId);
        router.push(
          `/dashboard/courses/${courseId}/study/build?${qs.toString()}`
        );
        setLoading(false);
        return;
      }

      if (firstMaterialId) {
        router.push(
          `/dashboard/courses/${courseId}/study?material=${encodeURIComponent(firstMaterialId)}`
        );
        router.refresh();
        setLoading(false);
        return;
      }

      setError("Invalid response from server (missing job id).");
    } catch {
      setBuildProgress(null);
      setError("Network error. Check your connection.");
    }

    setLoading(false);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragOver(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    addIngestFiles(e.dataTransfer.files);
  }

  if (!examGroupId) {
    return (
      <p className="text-sm text-zinc-500">
        Select a section tab above to enable uploads.
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {/* Per-upload study goal — applies only to this set of files. Self-study
          courses see it expanded; public courses see a collapsed toggle. */}
      <div className="rounded-2xl border border-zinc-200/90 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        {!showGoal ? (
          <button
            type="button"
            onClick={() => setShowGoal(true)}
            className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-zinc-700 hover:text-brand dark:text-zinc-300 dark:hover:text-brand-soft"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>🎯</span>
              Tell the AI what to focus on (optional)
            </span>
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Add a goal
            </span>
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="per-upload-goal"
                className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
              >
                <span aria-hidden className="mr-1">🎯</span>
                Goal for this upload
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  ({files.length > 1
                    ? `applies to all ${files.length} files`
                    : "applies to this lecture"}
                  )
                </span>
              </label>
              <button
                type="button"
                onClick={() => setShowGoal(false)}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Hide
              </button>
            </div>
            <textarea
              id="per-upload-goal"
              rows={3}
              value={studyGoal}
              onChange={(e) => {
                setStudyGoal(e.target.value);
                if (goalError) setGoalError(null);
              }}
              maxLength={4000}
              placeholder="e.g. Focus on the mechanism of ionic bonding — I already know Coulomb's law."
              className="block w-full resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void polishGoalInPlace()}
                disabled={polishingGoal || !studyGoal.trim()}
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {polishingGoal ? "Polishing…" : "✨ Polish into a one-liner"}
              </button>
              {goalError ? (
                <span className="text-xs text-red-600 dark:text-red-400">
                  {goalError}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div>
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Study materials
        </span>

        <input
          ref={inputRef}
          id="study-ingest"
          name="study-ingest"
          type="file"
          accept={INGEST_ACCEPT_ATTRIBUTE}
          multiple
          className="sr-only"
          onChange={(e) => {
            addIngestFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`mt-3 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all ${
            dragOver
              ? "scale-[1.01] border-brand bg-brand-blush/90 shadow-lg shadow-red-500/15 dark:border-brand-soft dark:bg-brand-blush/8"
              : "border-zinc-200 bg-zinc-50/80 hover:border-brand-border hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-brand-border/50 dark:hover:bg-zinc-900"
          }`}
        >
          <span className="pointer-events-none text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {dragOver
              ? "Drop files here"
              : "Drag and drop your study material here"}
          </span>
          <span className="pointer-events-none mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            PDFs, Word docs, slides, videos, audio, or images — each file
            builds its own course
          </span>
          <span className="pointer-events-none mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Limits: {INGEST_SIZE_HINT}
          </span>
        </button>

        {files.length > 0 && (
          <>
            {files.length > 1 ? (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Drag to reorder — all files are combined into one course.
              </p>
            ) : null}
            <ul className="mt-2 space-y-2">
              {previewFiles.map((file) => {
                // Index lookup against the *real* files array so reorder + remove
                // operate on the underlying state, not the optimistic preview.
                const realIndex = files.findIndex(
                  (f) => f.name === file.name && f.size === file.size
                );
                const isDragging =
                  dragFrom !== null && files[dragFrom]?.name === file.name && files[dragFrom]?.size === file.size;

                return (
                  <li
                    key={`${file.name}-${file.size}-${realIndex}`}
                    draggable={!loading && files.length > 1}
                    onDragStart={(e) => handleFileDragStart(e, realIndex)}
                    onDragOver={(e) => handleFileDragOver(e, realIndex)}
                    onDrop={(e) => handleFileDrop(e, realIndex)}
                    onDragEnd={handleFileDragEnd}
                    className={[
                      "flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm transition-[opacity,transform] duration-150 dark:border-zinc-700 dark:bg-zinc-950",
                      isDragging ? "opacity-40 scale-95" : "opacity-100 scale-100",
                      files.length > 1 && !loading ? "cursor-grab active:cursor-grabbing" : "",
                    ].join(" ")}
                  >
                    {files.length > 1 ? (
                      <span
                        className="flex h-6 w-5 shrink-0 items-center justify-center text-zinc-300 dark:text-zinc-600"
                        aria-hidden
                      >
                        <svg viewBox="0 0 10 16" fill="currentColor" className="h-3.5 w-3.5">
                          <circle cx="2.5" cy="2" r="1.5" />
                          <circle cx="7.5" cy="2" r="1.5" />
                          <circle cx="2.5" cy="7" r="1.5" />
                          <circle cx="7.5" cy="7" r="1.5" />
                          <circle cx="2.5" cy="12" r="1.5" />
                          <circle cx="7.5" cy="12" r="1.5" />
                        </svg>
                      </span>
                    ) : null}
                    <span className="shrink-0 text-base" aria-hidden>
                      {fileKindIcon(
                        describeIngestFile(file)?.kind ?? "pdf"
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {file.name}
                      </span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {formatLabel(
                          describeIngestFile(file)?.kind ?? "pdf"
                        )}{" "}
                        · {formatFileSize(file.size)}
                        {fileMeta[fileKey(file)]?.durationSec != null
                          ? ` · ${Math.round(fileMeta[fileKey(file)]!.durationSec! / 60)} min`
                          : ""}
                        {fileMeta[fileKey(file)]?.hint
                          ? ` · ${fileMeta[fileKey(file)]!.hint}`
                          : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => removeFile(realIndex)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <p className="mt-2 text-xs text-zinc-500">
          Your files are private to your account. Make sure you have permission
          to use copyrighted material. Videos and audio are transcribed (up to
          25MB per file for transcription). Processing can take several minutes
          for long recordings.
        </p>
      </div>

      {loading && buildProgress && (
        <div
          className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Course build in progress
          </p>
          <p className="mt-1.5 whitespace-pre-line text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {buildProgress.line}
          </p>
          <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            {buildProgress.bar === "indeterminate" ? (
              <div
                className="absolute inset-y-0 w-[32%] rounded-full bg-brand shadow-sm shadow-red-500/20 dark:bg-brand-soft dark:shadow-red-900/30 animate-course-upload-indeterminate"
                aria-hidden
              />
            ) : typeof buildProgress.bar === "number" ? (
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out dark:bg-brand-soft"
                style={{
                  width: `${Math.max(2, Math.min(100, buildProgress.bar))}%`,
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      {success && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 whitespace-pre-line">
          {success}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-line">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || files.length === 0}
        className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover disabled:opacity-60 dark:bg-brand dark:hover:bg-brand-soft"
      >
        {loading
          ? "Building…"
          : files.length > 1
            ? `Upload & build course (${files.length} files)`
            : "Upload & build course"}
      </button>
    </form>
  );
}
