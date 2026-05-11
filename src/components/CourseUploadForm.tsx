"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  describePdfIngestUploadFailure,
} from "@/lib/storage-upload-errors";
import {
  MAX_STUDY_PDF_BYTES,
  STUDY_PDF_INGEST_BUCKET,
} from "@/lib/study-pdf-ingest";

function isPdfFile(f: File): boolean {
  return (
    f.type === "application/pdf" ||
    f.name.toLowerCase().endsWith(".pdf")
  );
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatElapsedShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m ${rs}s` : `${m} min`;
}

/** Remaining wall time for this + following module server calls (each often ~1–4 min). */
function modulePhaseEtaLabel(modulesRemainingIncludingCurrent: number): string {
  if (modulesRemainingIncludingCurrent <= 0) return "";
  const lowMin = Math.max(1, modulesRemainingIncludingCurrent * 1);
  const highMin = Math.max(lowMin, modulesRemainingIncludingCurrent * 4);
  return lowMin === highMin
    ? `~${lowMin} min left (rough guess)`
    : `~${lowMin}–${highMin} min left (rough guess)`;
}

function jobStartedAtMs(createdAt?: string): number | null {
  if (typeof createdAt !== "string" || !createdAt.trim()) return null;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : null;
}

/** Poll after `POST /api/process-pdf` returns `202` + `jobId` (chunked: outline in background, then per-module expand). */
async function pollPdfIngestJob(
  jobId: string,
  onProgress?: (label: string) => void
): Promise<{
  materialId?: string;
  error?: string;
}> {
  /** Outline + several modules can exceed one serverless cap; allow a longer client wait. */
  const deadline = Date.now() + 22 * 60 * 1000;
  while (Date.now() < deadline) {
    const r = await fetch(`/api/process-pdf/jobs/${jobId}`);
    const raw = await r.text();
    let data: {
      status?: string;
      materialId?: string;
      error?: string;
      outlineReady?: boolean;
      modulesBuilt?: number;
      modulesTotal?: number;
      createdAt?: string;
    };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      await sleep(2000);
      continue;
    }
    if (!r.ok) {
      if (typeof data.error === "string" && data.error.trim()) {
        return { error: data.error.trim() };
      }
      return { error: `Status check failed (${r.status}).` };
    }
    if (data.status === "complete" && data.materialId) {
      return { materialId: data.materialId };
    }
    if (data.status === "failed") {
      return { error: data.error ?? "PDF build failed." };
    }

    if (
      data.status === "running" &&
      data.outlineReady &&
      typeof data.modulesBuilt === "number" &&
      typeof data.modulesTotal === "number" &&
      data.modulesTotal > 0 &&
      data.modulesBuilt < data.modulesTotal
    ) {
      const next = data.modulesBuilt + 1;
      const remaining = data.modulesTotal - data.modulesBuilt;
      const started = jobStartedAtMs(data.createdAt);
      const elapsedPart =
        started != null
          ? ` · ${formatElapsedShort(Date.now() - started)} so far`
          : "";
      onProgress?.(
        `Module ${next} of ${data.modulesTotal} — this step often takes ~1–3 min. ${modulePhaseEtaLabel(remaining)}${elapsedPart}.`
      );
      let exp: Response;
      try {
        exp = await fetch("/api/process-pdf/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
      } catch {
        return {
          error:
            "Network error while building a module. Check your connection and try uploading again.",
        };
      }
      const expRaw = await exp.text();
      let expJson: {
        error?: string;
        complete?: boolean;
        materialId?: string;
      };
      try {
        expJson = JSON.parse(expRaw) as typeof expJson;
      } catch {
        return { error: "Invalid response while building a module." };
      }
      if (!exp.ok) {
        return {
          error:
            typeof expJson.error === "string" && expJson.error.trim()
              ? expJson.error.trim()
              : `Module ${next} failed (${exp.status}).`,
        };
      }
      if (expJson.complete === true && typeof expJson.materialId === "string") {
        return { materialId: expJson.materialId };
      }
      continue;
    }

    if (
      (data.status === "running" || data.status === "pending") &&
      !data.outlineReady
    ) {
      const started = jobStartedAtMs(data.createdAt);
      const elapsedPart =
        started != null
          ? ` Elapsed: ${formatElapsedShort(Date.now() - started)}.`
          : "";
      onProgress?.(
        `Reading your PDF + drafting outline — usually ~1–5 min.${elapsedPart} Next: each course module is built one at a time (typical full run ~5–25 min; big PDFs longer).`
      );
    }

    await sleep(1800);
  }
  return {
    error:
      "Build is taking longer than expected (waited 22 minutes). Refresh the course page — it may still complete.",
  };
}

export function CourseUploadForm({
  courseId,
  examGroupId,
}: {
  courseId: string;
  examGroupId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const addPdfFiles = useCallback((list: FileList | File[] | null | undefined) => {
    const arr = Array.from(list ?? []).filter(isPdfFile);
    const nonPdf = Array.from(list ?? []).filter((f) => !isPdfFile(f));
    if (nonPdf.length > 0 && arr.length === 0) {
      setError("Please use PDF files (.pdf) only.");
      return;
    }
    if (nonPdf.length > 0) {
      setError(
        `${nonPdf.length} non-PDF file(s) skipped. Only PDFs are added.`
      );
    } else {
      setError(null);
    }
    setSuccess(null);
    if (arr.length === 0) return;

    setFiles((prev) => {
      const next = [...prev];
      for (const f of arr) {
        const dup = next.some(
          (x) => x.name === f.name && x.size === f.size
        );
        if (!dup) next.push(f);
      }
      return next;
    });
  }, []);

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
    setSuccess(null);
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
      setError("Choose or drop at least one PDF.");
      return;
    }

    const queue = [...files];
    const total = queue.length;
    setLoading(true);

    const failures: string[] = [];
    let lastMaterialId: string | undefined;

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

      for (let i = 0; i < queue.length; i++) {
        const file = queue[i];
        setProgressLabel(
          total > 1
            ? `Building ${i + 1} of ${total}: ${file.name} (one file at a time — more reliable than parallel)`
            : `Building: ${file.name}`
        );

        if (file.size > MAX_STUDY_PDF_BYTES) {
          failures.push(
            `${file.name}: PDF is too large (max 40 MB). Split the file or export fewer pages.`
          );
          continue;
        }

        const storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;

        const { error: upErr } = await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .upload(storagePath, file, {
            contentType: "application/pdf",
            cacheControl: "3600",
            upsert: false,
          });

        if (upErr) {
          const detail =
            typeof upErr === "object" && upErr && "message" in upErr
              ? String((upErr as { message: unknown }).message)
              : String(upErr);
          failures.push(
            `${file.name}: ${describePdfIngestUploadFailure(detail)}`
          );
          continue;
        }

        let res: Response;
        try {
          res = await fetch("/api/process-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              courseId,
              examGroupId,
              storagePath,
              originalFileName: file.name,
            }),
          });
        } catch {
          await supabase.storage
            .from(STUDY_PDF_INGEST_BUCKET)
            .remove([storagePath])
            .catch(() => {});
          failures.push(`${file.name}: Network error while starting build.`);
          continue;
        }

        const raw = await res.text();

        if (!res.ok) {
          failures.push(
            `${file.name}: ${messageFromUploadResponse(res, raw)}`
          );
          continue;
        }

        let materialId: string | undefined;
        try {
          const body = JSON.parse(raw) as {
            materialId?: string;
            jobId?: string;
          };
          if (typeof body.materialId === "string" && body.materialId) {
            materialId = body.materialId;
          } else if (typeof body.jobId === "string" && body.jobId) {
            setProgressLabel(
              total > 1
                ? `${i + 1}/${total} ${file.name}: generating course…`
                : `${file.name}: generating course…`
            );
            const polled = await pollPdfIngestJob(body.jobId, (label) =>
              setProgressLabel(
                total > 1
                  ? `${i + 1}/${total} ${file.name}: ${label}`
                  : `${file.name}: ${label}`
              )
            );
            if (polled.error) {
              failures.push(`${file.name}: ${polled.error}`);
              continue;
            }
            materialId = polled.materialId;
          }
        } catch {
          failures.push(`${file.name}: Invalid response from server.`);
          continue;
        }

        if (!materialId) {
          failures.push(
            `${file.name}: Invalid response from server (missing material id).`
          );
          continue;
        }
        lastMaterialId = materialId;
      }

      setProgressLabel(null);
      setFiles([]);

      if (total === 1 && failures.length === 0 && lastMaterialId) {
        router.push(
          `/dashboard/courses/${courseId}/study?material=${encodeURIComponent(lastMaterialId)}`
        );
        router.refresh();
        return;
      }

      router.refresh();

      if (failures.length > 0) {
        const okCount = total - failures.length;
        setError(
          okCount > 0
            ? `${okCount} of ${total} built successfully.\n${failures.join("\n")}`
            : failures.join("\n")
        );
        if (okCount > 0) {
          setSuccess(`${okCount} upload(s) ready under this section.`);
        }
      } else {
        setSuccess(
          total === 1
            ? "Upload ready — open it from the list below."
            : `Built ${total} study sets — they appear in this group below.`
        );
      }
    } catch {
      setProgressLabel(null);
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
    addPdfFiles(e.dataTransfer.files);
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
      <div>
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          PDF or lecture slides
        </span>

        <input
          ref={inputRef}
          id="pdf"
          name="pdf"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            addPdfFiles(e.target.files);
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
            {dragOver ? "Drop PDFs here" : "Drag & drop PDFs here"}
          </span>
          <span className="pointer-events-none mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            or click to browse — you can select multiple files
          </span>
        </button>

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {file.name}
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => removeFile(index)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-xs text-zinc-500">
          Text must be selectable in the PDF for best results (scanned pages may
          not extract well). Multiple files are processed one after another.
          Large courses are built in several server steps (outline, then each
          module); keep this tab open until the spinner finishes.
        </p>
      </div>

      {progressLabel && (
        <p className="text-sm font-medium text-brand dark:text-brand-soft">
          {progressLabel}
        </p>
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
            ? `Upload & build ${files.length} courses`
            : "Upload & build course"}
      </button>
    </form>
  );
}
