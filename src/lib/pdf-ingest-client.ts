/**
 * Browser-side helpers for chunked PDF ingest (poll job + trigger expand).
 * Shared by `CourseUploadForm` (local / edge cases) and `CourseBuildTheater`.
 */

import { parseLivePreviewCoursePayload } from "@/lib/ai/course-payload";
import type { CoursePayload } from "@/types/course";

export type PdfBuildProgressUI = {
  line: string;
  bar: number | "indeterminate" | null;
};

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

function jobStartedAtMs(createdAt?: string): number | null {
  if (typeof createdAt !== "string" || !createdAt.trim()) return null;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : null;
}

/** Latest server row fields from `GET /jobs/:id` (each poll). Use for multi-PDF UI so tab order stays upload order while previews land in completion order. */
export type PollPdfIngestJobSnapshot = {
  status: string;
  outlineReady: boolean;
  modulesBuilt?: number;
  modulesTotal?: number;
};

export type PollPdfIngestOptions = {
  signal?: AbortSignal;
  /** Latest Claude output tail while the model streams (outline / module JSON). */
  onStreamPreview?: (text: string | null) => void;
  /** Merged course preview (outline + partial modules) for the study-style live UI. */
  onPreviewCourse?: (course: CoursePayload | null) => void;
  /** Fires after every successful job GET parse (status, outline gate, module counts). */
  onJobSnapshot?: (snapshot: PollPdfIngestJobSnapshot) => void;
};

/** Poll after `POST /api/process-pdf` returns `202` + `jobId` (chunked pipeline). */
export async function pollPdfIngestJob(
  jobId: string,
  onProgress?: (info: PdfBuildProgressUI) => void,
  options?: PollPdfIngestOptions
): Promise<{
  materialId?: string;
  error?: string;
}> {
  const signal = options?.signal;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { error: "Cancelled." };
    }
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
      streamPreview?: string | null;
      previewCourse?: unknown;
    };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      await sleep(2000);
      continue;
    }

    const snapStatus = typeof data.status === "string" ? data.status : "unknown";
    options?.onJobSnapshot?.({
      status: snapStatus,
      outlineReady: Boolean(data.outlineReady),
      modulesBuilt:
        typeof data.modulesBuilt === "number" ? data.modulesBuilt : undefined,
      modulesTotal:
        typeof data.modulesTotal === "number" ? data.modulesTotal : undefined,
    });

    if (!r.ok) {
      if (typeof data.error === "string" && data.error.trim()) {
        return { error: data.error.trim() };
      }
      return { error: `Status check failed (${r.status}).` };
    }

    if ("streamPreview" in data) {
      const raw = (data as { streamPreview?: unknown }).streamPreview;
      if (raw === null) options?.onStreamPreview?.(null);
      else if (typeof raw === "string") options?.onStreamPreview?.(raw);
    }

    if ("previewCourse" in data) {
      const raw = (data as { previewCourse?: unknown }).previewCourse;
      if (raw === null || raw === undefined) {
        options?.onPreviewCourse?.(null);
      } else if (typeof raw === "object") {
        try {
          options?.onPreviewCourse?.(parseLivePreviewCoursePayload(raw));
        } catch {
          options?.onPreviewCourse?.(null);
        }
      }
    }

    if (data.status === "complete" && data.materialId) {
      return { materialId: data.materialId };
    }
    if (data.status === "failed") {
      return { error: data.error ?? "PDF build failed." };
    }

    // Drive `POST /expand`: (a) next module when built < total, (b) finalize-only when
    // built === total but job is still `running` (server saves all modules then finalizes;
    // if the client never got the completion response from the last module expand, or
    // finalize lagged, GET can sit at N/N + running — without another expand the UI
    // would spin on "Writing module N of N" forever).
    const built = data.modulesBuilt;
    const total = data.modulesTotal;
    const inModulePhase =
      data.status === "running" &&
      data.outlineReady &&
      typeof built === "number" &&
      typeof total === "number" &&
      total > 0 &&
      built <= total;

    if (inModulePhase && built < total) {
      const next = built + 1;
      const started = jobStartedAtMs(data.createdAt);
      const elapsedPart =
        started != null
          ? ` · ${formatElapsedShort(Date.now() - started)}`
          : "";
      onProgress?.({
        line: `Writing module ${next} of ${total}${elapsedPart}…`,
        bar: Math.min(100, ((next - 0.5) / total) * 100),
      });
      let exp: Response;
      try {
        exp = await fetch("/api/process-pdf/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
          signal,
        });
      } catch {
        if (signal?.aborted) return { error: "Cancelled." };
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
        modulesBuilt?: number;
        modulesTotal?: number;
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
      if (
        expJson.complete !== true &&
        typeof expJson.modulesBuilt === "number" &&
        typeof expJson.modulesTotal === "number" &&
        expJson.modulesTotal > 0
      ) {
        const startedMid = jobStartedAtMs(data.createdAt);
        const elapsedMid =
          startedMid != null
            ? ` · ${formatElapsedShort(Date.now() - startedMid)}`
            : "";
        onProgress?.({
          line: `Finished module ${expJson.modulesBuilt} of ${expJson.modulesTotal}${elapsedMid}. Preparing the next…`,
          bar: Math.min(
            100,
            (expJson.modulesBuilt / expJson.modulesTotal) * 100
          ),
        });
      }
      continue;
    }

    if (inModulePhase && built === total) {
      const started = jobStartedAtMs(data.createdAt);
      const elapsedPart =
        started != null
          ? ` · ${formatElapsedShort(Date.now() - started)}`
          : "";
      onProgress?.({
        line: `Saving your study set (${total} module${total === 1 ? "" : "s"})…${elapsedPart}`,
        bar: 100,
      });
      let exp: Response;
      try {
        exp = await fetch("/api/process-pdf/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
          signal,
        });
      } catch {
        if (signal?.aborted) return { error: "Cancelled." };
        return {
          error:
            "Network error while saving the study set. Check your connection — the build may still finish; refresh the course page.",
        };
      }
      const expRaw = await exp.text();
      let expJson: {
        error?: string;
        complete?: boolean;
        materialId?: string;
        modulesBuilt?: number;
        modulesTotal?: number;
      };
      try {
        expJson = JSON.parse(expRaw) as typeof expJson;
      } catch {
        return { error: "Invalid response while saving the study set." };
      }
      if (!exp.ok) {
        return {
          error:
            typeof expJson.error === "string" && expJson.error.trim()
              ? expJson.error.trim()
              : `Save step failed (${exp.status}).`,
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
      const elapsedMs = started != null ? Date.now() - started : 0;
      const elapsedPart =
        started != null
          ? ` · ${formatElapsedShort(Date.now() - started)}`
          : "";
      const phaseLine =
        elapsedMs < 90_000
          ? "Step 1/2: Extracting text from your PDF (huge slide files can take several minutes before any AI runs)…"
          : "Step 2/2: Planning course outline with AI (then writing each module)…";
      onProgress?.({
        line: `${phaseLine}${elapsedPart}`,
        bar: "indeterminate",
      });
    }

    await sleep(1800);
  }
  return {
    error:
      "Build is taking longer than expected (waited 15 minutes). For `COURSE_BUILD_PROFILE=full` or very large decks, upload one PDF at a time or check the host logs. Refresh the course page — it may still complete.",
  };
}
