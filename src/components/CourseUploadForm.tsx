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

  // ---- lecture grouping ("stacks") ----
  // Each group becomes ONE combined lecture build. By default every file is
  // its own group (the original 1-file-1-lecture behaviour); the student can
  // drag files together to combine related material into a single lecture.
  type Stack = { id: string; name: string; keys: string[] };
  const [groups, setGroups] = useState<Stack[]>([]);
  const stackSeq = useRef(0);
  // When a file is dropped directly onto a lecture card, remember which group
  // it should join so the reconcile effect places it there instead of giving
  // it a fresh lecture of its own.
  const pendingAssignRef = useRef<Record<string, string>>({});
  // Drag state: which file chip is being dragged + the group hovered over.
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const fileKey = (f: File) => `${f.name}:${f.size}`;

  const fileByKey = useMemo(() => {
    const m = new Map<string, File>();
    for (const f of files) m.set(fileKey(f), f);
    return m;
  }, [files]);

  // Keep `groups` reconciled with `files`: drop removed files, retire empty
  // groups, and give each newly-added file its own group.
  useEffect(() => {
    setGroups((prev) => {
      const present = new Set(files.map(fileKey));
      let next = prev
        .map((g) => ({ ...g, keys: g.keys.filter((k) => present.has(k)) }))
        .filter((g) => g.keys.length > 0);
      const assigned = new Set(next.flatMap((g) => g.keys));
      for (const f of files) {
        const k = fileKey(f);
        if (assigned.has(k)) continue;
        const target = pendingAssignRef.current[k];
        if (target && next.some((g) => g.id === target)) {
          next = next.map((g) =>
            g.id === target ? { ...g, keys: [...g.keys, k] } : g
          );
          delete pendingAssignRef.current[k];
        } else {
          stackSeq.current += 1;
          next = [
            ...next,
            { id: `stk-${stackSeq.current}`, name: "", keys: [k] },
          ];
        }
        assigned.add(k);
      }
      return next;
    });
  }, [files]);

  const moveKeyToGroup = useCallback((key: string, targetId: string) => {
    setGroups((prev) => {
      if (prev.find((g) => g.id === targetId)?.keys.includes(key)) return prev;
      const next = prev
        .map((g) =>
          g.id === targetId
            ? { ...g, keys: [...g.keys, key] }
            : { ...g, keys: g.keys.filter((k) => k !== key) }
        )
        .filter((g) => g.keys.length > 0);
      return next;
    });
  }, []);

  const splitKeyToNewGroup = useCallback((key: string) => {
    setGroups((prev) => {
      const fromGroup = prev.find((g) => g.keys.includes(key));
      // No-op when the file is already alone in its group.
      if (fromGroup && fromGroup.keys.length === 1) return prev;
      stackSeq.current += 1;
      const fresh = {
        id: `stk-${stackSeq.current}`,
        name: "",
        keys: [key],
      };
      return prev
        .map((g) => ({ ...g, keys: g.keys.filter((k) => k !== key) }))
        .filter((g) => g.keys.length > 0)
        .concat(fresh);
    });
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  }, []);

  const combineAllGroups = useCallback(() => {
    setGroups((prev) => {
      if (prev.length <= 1) return prev;
      const first = prev[0];
      const allKeys = prev.flatMap((g) => g.keys);
      return [{ ...first, keys: allKeys }];
    });
  }, []);

  const splitAllGroups = useCallback(() => {
    setGroups(() =>
      files.map((f) => {
        stackSeq.current += 1;
        return {
          id: `stk-${stackSeq.current}`,
          name: "",
          keys: [fileKey(f)],
        };
      })
    );
  }, [files]);

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
    (
      list: FileList | File[] | null | undefined,
      targetGroupId?: string
    ) => {
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
          if (!dup) {
            next.push(f);
            if (targetGroupId) {
              pendingAssignRef.current[fileKey(f)] = targetGroupId;
            }
          }
        }
        return next;
      });
    },
    []
  );

  function removeFileByKey(key: string) {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
    setError(null);
    setSuccess(null);
  }

  // Drag a file chip onto a lecture group to combine, or onto the "new
  // lecture" zone to split it back out.
  function handleChipDragStart(e: React.DragEvent, key: string) {
    if (loading) return;
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", key);
    } catch {
      /* some browsers throw on setData during certain events */
    }
  }

  function handleGroupDragOver(e: React.DragEvent, groupId: string | null) {
    const draggingExternalFiles = e.dataTransfer.types.includes("Files");
    // Accept either an internal chip move or files dragged in from the OS.
    if (draggedKey === null && !draggingExternalFiles) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect =
      draggedKey === null && draggingExternalFiles ? "copy" : "move";
    if (dropTarget !== groupId) setDropTarget(groupId);
  }

  function handleGroupDrop(e: React.DragEvent, groupId: string | null) {
    const external = e.dataTransfer.files;
    const droppingExternalFiles =
      draggedKey === null && external && external.length > 0;
    if (draggedKey === null && !droppingExternalFiles) return;
    e.preventDefault();
    e.stopPropagation();
    if (droppingExternalFiles) {
      // Files from the desktop dropped straight onto a lecture join that
      // lecture (the "new lecture" zone isn't shown for external drags).
      addIngestFiles(external, groupId ?? undefined);
    } else if (draggedKey !== null) {
      if (groupId === null) splitKeyToNewGroup(draggedKey);
      else moveKeyToGroup(draggedKey, groupId);
    }
    setDraggedKey(null);
    setDropTarget(null);
    dragDepthRef.current = 0;
    setDragOver(false);
  }

  function handleChipDragEnd() {
    setDraggedKey(null);
    setDropTarget(null);
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

    // Each group becomes its own ingest job, so the per-job limits (file count
    // + combined size) must hold within each group, not across the whole upload.
    const lectureGroups = groups
      .filter((g) => g.keys.length > 0)
      .map((g, i) => ({
        ...g,
        displayName: g.name.trim() || `Lecture ${i + 1}`,
      }));
    for (const g of lectureGroups) {
      const descriptors = g.keys
        .map((k) => fileByKey.get(k))
        .filter((f): f is File => Boolean(f))
        .map((f) => describeIngestFile(f))
        .filter((d): d is NonNullable<typeof d> => d !== null);
      const batchErr = validateIngestBatch(descriptors);
      if (batchErr) {
        setError(`${g.displayName}: ${batchErr}`);
        return;
      }
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

      // Map every uploaded file back to its API payload by key so we can group
      // them into the lecture builds the student arranged. Upload results are
      // index-aligned with `files` (and `prepared`), so we zip by position.
      const apiFileByKey = new Map<
        string,
        { storagePath: string; originalFileName: string }
      >();
      files.forEach((f, i) => {
        const r = uploadResults[i];
        if (r && !r.error) {
          apiFileByKey.set(fileKey(f), {
            storagePath: r.storagePath,
            originalFileName: r.originalFileName,
          });
        }
      });

      // Build one ingest job per lecture group. Files inside a group are
      // combined into a single course; the AI decides the lesson/module split
      // across them (file boundaries are not lesson boundaries).
      const buildGroups = lectureGroups
        .map((g) => ({
          name: g.displayName,
          files: g.keys
            .map((k) => apiFileByKey.get(k))
            .filter(
              (f): f is { storagePath: string; originalFileName: string } =>
                Boolean(f)
            ),
        }))
        .filter((g) => g.files.length > 0);

      setBuildProgress({
        line:
          buildGroups.length > 1
            ? `Starting ${buildGroups.length} lecture builds…`
            : "Starting course build…",
        bar: "indeterminate",
      });

      // Kicked off in parallel so all jobs are created at once and the build
      // page opens with every lecture building simultaneously.
      type StartOutcome = {
        group: { name: string };
        jobId?: string;
        materialId?: string;
        error?: string;
      };
      const startOutcomes: StartOutcome[] = await Promise.all(
        buildGroups.map(async (g): Promise<StartOutcome> => {
          try {
            const res = await fetch("/api/process-pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                courseId,
                examGroupId,
                files: g.files,
                studyContext: studyGoal.trim() || undefined,
              }),
            });
            const raw = await res.text();
            if (!res.ok) {
              return { group: g, error: messageFromUploadResponse(res, raw) };
            }
            const body = JSON.parse(raw) as {
              materialId?: string;
              jobId?: string;
            };
            return {
              group: g,
              jobId: typeof body.jobId === "string" ? body.jobId : undefined,
              materialId:
                typeof body.materialId === "string" ? body.materialId : undefined,
            };
          } catch {
            return { group: g, error: "Network error while starting build." };
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
        setError(`${failure.group.name}: ${failure.error}`);
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
                  ({groups.length > 1
                    ? `applies to all ${groups.length} lectures`
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
            PDFs, Word docs, slides, videos, audio, or images — group related
            files into one lecture
          </span>
          <span className="pointer-events-none mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Limits: {INGEST_SIZE_HINT}
          </span>
        </button>

        {files.length > 0 && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {files.length === 1
                  ? "1 file → 1 lecture."
                  : `${files.length} files → ${groups.length} lecture${
                      groups.length > 1 ? "s" : ""
                    }. Drag a file onto another lecture to combine them — the AI then weaves them into one course.`}
              </p>
              {files.length > 1 ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={combineAllGroups}
                    disabled={loading || groups.length <= 1}
                    className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Combine into one
                  </button>
                  <button
                    type="button"
                    onClick={splitAllGroups}
                    disabled={loading || groups.length === files.length}
                    className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    One per file
                  </button>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              {groups.map((group, gi) => {
                const groupFiles = group.keys
                  .map((k) => fileByKey.get(k))
                  .filter((f): f is File => Boolean(f));
                const combined = groupFiles.length > 1;
                const isTarget = dropTarget === group.id;
                return (
                  <div
                    key={group.id}
                    onDragOver={(e) => handleGroupDragOver(e, group.id)}
                    onDrop={(e) => handleGroupDrop(e, group.id)}
                    onDragLeave={() => {
                      if (dropTarget === group.id) setDropTarget(null);
                    }}
                    className={[
                      "rounded-2xl border p-3 transition-colors",
                      isTarget
                        ? "border-brand bg-brand-blush/70 dark:border-brand-soft dark:bg-brand-blush/10"
                        : combined
                          ? "border-zinc-300 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/50"
                          : "border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30",
                    ].join(" ")}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="shrink-0 text-xs font-semibold text-zinc-400 dark:text-zinc-500">
                        {gi + 1}
                      </span>
                      <input
                        type="text"
                        value={group.name}
                        disabled={loading}
                        onChange={(e) => renameGroup(group.id, e.target.value)}
                        placeholder="Name this lecture (optional)"
                        className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-zinc-900 outline-none hover:border-zinc-200 focus:border-brand focus:bg-white dark:text-zinc-100 dark:hover:border-zinc-700 dark:focus:bg-zinc-950"
                      />
                      {combined ? (
                        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand dark:bg-brand-soft/15 dark:text-brand-soft">
                          {groupFiles.length} files combined
                        </span>
                      ) : null}
                    </div>

                    <ul className="space-y-2">
                      {groupFiles.map((file) => {
                        const key = fileKey(file);
                        const isDragging = draggedKey === key;
                        return (
                          <li
                            key={key}
                            draggable={!loading && files.length > 1}
                            onDragStart={(e) => handleChipDragStart(e, key)}
                            onDragEnd={handleChipDragEnd}
                            className={[
                              "flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm transition-[opacity,transform] duration-150 dark:border-zinc-700 dark:bg-zinc-950",
                              isDragging
                                ? "opacity-40 scale-95"
                                : "opacity-100 scale-100",
                              files.length > 1 && !loading
                                ? "cursor-grab active:cursor-grabbing"
                                : "",
                            ].join(" ")}
                          >
                            {files.length > 1 ? (
                              <span
                                className="flex h-6 w-5 shrink-0 items-center justify-center text-zinc-300 dark:text-zinc-600"
                                aria-hidden
                              >
                                <svg
                                  viewBox="0 0 10 16"
                                  fill="currentColor"
                                  className="h-3.5 w-3.5"
                                >
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
                              {fileKindIcon(describeIngestFile(file)?.kind ?? "pdf")}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
                                {file.name}
                              </span>
                              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                {formatLabel(describeIngestFile(file)?.kind ?? "pdf")}{" "}
                                · {formatFileSize(file.size)}
                                {fileMeta[key]?.durationSec != null
                                  ? ` · ${Math.round(fileMeta[key]!.durationSec! / 60)} min`
                                  : ""}
                                {fileMeta[key]?.hint
                                  ? ` · ${fileMeta[key]!.hint}`
                                  : ""}
                              </span>
                            </span>
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => removeFileByKey(key)}
                              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}

              {draggedKey !== null && files.length > 1 ? (
                <div
                  onDragOver={(e) => handleGroupDragOver(e, null)}
                  onDrop={(e) => handleGroupDrop(e, null)}
                  onDragLeave={() => {
                    if (dropTarget === null) setDropTarget(null);
                  }}
                  className={[
                    "flex items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center text-xs font-medium transition-colors",
                    dropTarget === null
                      ? "border-brand bg-brand-blush/70 text-brand dark:border-brand-soft dark:bg-brand-blush/10 dark:text-brand-soft"
                      : "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
                  ].join(" ")}
                >
                  Drop here to split into its own lecture
                </div>
              ) : null}
            </div>
          </div>
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
          : groups.length > 1
            ? `Upload & build ${groups.length} lectures`
            : "Upload & build course"}
      </button>
    </form>
  );
}
