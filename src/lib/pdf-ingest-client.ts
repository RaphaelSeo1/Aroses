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

/** Gap between consecutive expand calls per PDF (ms). */
const EXPAND_MODULE_GAP_MS = 25;

/** Poll job row while a long /expand call runs so module counts tick up live. */
const EXPAND_PROGRESS_POLL_MS = 900;

async function pollJobProgressWhileExpandRuns(
  jobId: string,
  signal: AbortSignal | undefined,
  options: {
    createdAt?: string;
    modulesTotal: number;
    modulesBuiltStart: number;
    onProgress?: (info: PdfBuildProgressUI) => void;
    onJobSnapshot?: PollPdfIngestOptions["onJobSnapshot"];
    onPreviewCourse?: PollPdfIngestOptions["onPreviewCourse"];
    onStreamPreview?: PollPdfIngestOptions["onStreamPreview"];
  },
  expandPromise: Promise<
    | { ok: true; json: ExpandResponseJson }
    | { ok: false; status: number; json: ExpandResponseJson | null }
  >
): Promise<
  | { ok: true; json: ExpandResponseJson }
  | { ok: false; status: number; json: ExpandResponseJson | null }
> {
  let lastBuilt = options.modulesBuiltStart;
  const started = jobStartedAtMs(options.createdAt);

  const formatLine = (built: number, suffix: string) => {
    const elapsed =
      started != null ? ` · ${formatElapsedShort(Date.now() - started)}` : "";
    const bar =
      options.modulesTotal > 0
        ? Math.min(100, ((built + 0.35) / options.modulesTotal) * 100)
        : ("indeterminate" as const);
    return {
      line: `Writing modules… · ${built}/${options.modulesTotal} built${elapsed}${suffix}`,
      bar,
    };
  };

  const applySnapshot = (data: JobGetJson) => {
    const snapStatus = typeof data.status === "string" ? data.status : "unknown";
    const rawPhase = data.ingestPhase;
    const ingestPhase: PdfIngestPhase | undefined =
      rawPhase === "reading_pdf" ||
      rawPhase === "reading_full_pdf" ||
      rawPhase === "digesting_full_pdf" ||
      rawPhase === "planning_preview" ||
      rawPhase === "planning_outline" ||
      rawPhase === "enriching_sources" ||
      rawPhase === "writing_modules" ||
      rawPhase === "reviewing_transcript" ||
      rawPhase === "transcribing"
        ? rawPhase
        : undefined;
    options.onJobSnapshot?.({
      status: snapStatus,
      outlineReady: Boolean(data.outlineReady),
      ingestPhase,
      ingestTranscript:
        typeof data.ingestTranscript === "string"
          ? data.ingestTranscript
          : undefined,
      modulesBuilt:
        typeof data.modulesBuilt === "number" ? data.modulesBuilt : undefined,
      modulesTotal:
        typeof data.modulesTotal === "number" ? data.modulesTotal : undefined,
    });
    if ("streamPreview" in data) {
      const raw = (data as { streamPreview?: unknown }).streamPreview;
      if (raw === null) options.onStreamPreview?.(null);
      else if (typeof raw === "string") options.onStreamPreview?.(raw);
    }
    if ("previewCourse" in data) {
      const raw = (data as { previewCourse?: unknown }).previewCourse;
      if (raw === null || raw === undefined) {
        options.onPreviewCourse?.(null);
      } else if (typeof raw === "object") {
        try {
          options.onPreviewCourse?.(parseLivePreviewCoursePayload(raw));
        } catch {
          options.onPreviewCourse?.(null);
        }
      }
    }
  };

  const pollOnce = async () => {
    const got = await fetchJobStatusWithRetry(jobId, signal);
    if (got.kind !== "ok") return;
    const reported =
      typeof got.data.modulesBuilt === "number"
        ? got.data.modulesBuilt
        : lastBuilt;
    // Clamp the displayed count to be monotonic: built modules only ever grow,
    // so a transient lower reading (stale read / brief server race) must never
    // make the counter visibly regress (e.g. "2/2 → 1/2").
    const built = Math.max(lastBuilt, reported);
    if (built !== lastBuilt) {
      lastBuilt = built;
      options.onProgress?.(formatLine(built, ""));
    }
    applySnapshot(got.data);
  };

  options.onProgress?.(
    formatLine(
      lastBuilt,
      lastBuilt === 0 ? " · generating first batch…" : ""
    )
  );

  let expandDone = false;
  void expandPromise.finally(() => {
    expandDone = true;
  });

  while (!expandDone) {
    if (signal?.aborted) break;
    await sleep(EXPAND_PROGRESS_POLL_MS);
    if (expandDone) break;
    await pollOnce();
    if (!expandDone) {
      options.onProgress?.(formatLine(lastBuilt, " · still working…"));
    }
  }

  return expandPromise;
}

/**
 * Max parallel POST /expand calls across all in-tab PDF jobs.
 * The Anthropic retry logic handles 429s, so set this high enough
 * that all PDFs can generate modules simultaneously.
 */
const EXPAND_FETCH_MAX_CONCURRENT = 20;

const expandFetchConcurrency = (() => {
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire(): Promise<void> {
      return new Promise((resolve) => {
        if (inFlight < EXPAND_FETCH_MAX_CONCURRENT) {
          inFlight++;
          resolve();
        } else {
          waiters.push(() => {
            inFlight++;
            resolve();
          });
        }
      });
    },
    release(): void {
      inFlight--;
      const w = waiters.shift();
      if (w) w();
    },
  };
})();

/** Vercel / edge / origin blips — retry instead of forcing a full page refresh. */
const TRANSIENT_HTTP = new Set([
  408, 429, 500, 502, 503, 504, 524,
]);

type ExpandResponseJson = {
  error?: string;
  complete?: boolean;
  materialId?: string;
  modulesBuilt?: number;
  modulesTotal?: number;
};

type JobGetJson = {
  status?: string;
  materialId?: string;
  error?: string;
  outlineReady?: boolean;
  modulesBuilt?: number;
  modulesTotal?: number;
  createdAt?: string;
  streamPreview?: string | null;
  previewCourse?: unknown;
  ingestPhase?: PdfIngestPhase | null;
  ingestTranscript?: string;
};

export type PdfIngestPhase =
  | "reading_pdf"
  | "reading_full_pdf"
  | "digesting_full_pdf"
  | "planning_preview"
  | "planning_outline"
  | "enriching_sources"
  | "writing_modules"
  | "reviewing_transcript"
  | "transcribing";

/** Per-attempt timeout for GET /jobs/:id. Stops the poll from hanging forever if a single fetch stalls. */
const JOB_GET_TIMEOUT_MS = 45_000;

function combinedSignal(outer: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onOuterAbort = () => ctl.abort();
  if (outer) {
    if (outer.aborted) ctl.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  return {
    signal: ctl.signal,
    cancel: () => {
      clearTimeout(timer);
      if (outer) outer.removeEventListener("abort", onOuterAbort);
    },
  };
}

/**
 * GET job row with retries (cold starts, rate limits, brief network loss).
 * Each attempt has a hard timeout so a single hung fetch can't block polling forever.
 */
async function fetchJobStatusWithRetry(
  jobId: string,
  signal: AbortSignal | undefined
): Promise<
  | { kind: "ok"; r: Response; data: JobGetJson; raw: string }
  | { kind: "soft" }
  | { kind: "fatal"; error: string }
> {
  for (let attempt = 0; attempt < 14; attempt++) {
    if (signal?.aborted) {
      return { kind: "fatal", error: "Cancelled." };
    }
    let r: Response;
    const attemptSignal = combinedSignal(signal, JOB_GET_TIMEOUT_MS);
    try {
      r = await fetch(`/api/process-pdf/jobs/${jobId}`, {
        signal: attemptSignal.signal,
        cache: "no-store",
      });
      attemptSignal.cancel();
    } catch {
      attemptSignal.cancel();
      if (signal?.aborted) return { kind: "fatal", error: "Cancelled." };
      await sleep(Math.min(12_000, 900 + attempt * 1_000));
      continue;
    }
    if (TRANSIENT_HTTP.has(r.status)) {
      await sleep(
        r.status === 429
          ? Math.min(75_000, 4_000 + attempt * 6_000)
          : Math.min(20_000, 1_200 + attempt * 1_800)
      );
      continue;
    }

    const raw = await r.text();
    let data: JobGetJson;
    try {
      data = JSON.parse(raw) as JobGetJson;
    } catch {
      await sleep(2_000);
      continue;
    }

    if (!r.ok) {
      if (typeof data.error === "string" && data.error.trim()) {
        return { kind: "fatal", error: data.error.trim() };
      }
      if (r.status >= 500) {
        await sleep(Math.min(16_000, 1_500 + attempt * 2_000));
        continue;
      }
      return {
        kind: "fatal",
        error: `Status check failed (${r.status}).`,
      };
    }

    return { kind: "ok", r, data, raw };
  }
  return { kind: "soft" };
}

/** Per-attempt timeout for /expand fetch. Slightly longer than Vercel maxDuration=300s. */
const EXPAND_FETCH_TIMEOUT_MS = 320_000;

/**
 * POST /expand with retries when Vercel returns 429 (org output-token-per-minute, etc.).
 * Each attempt has a hard timeout so hung server invocations don't block forever.
 */
async function postProcessPdfExpand(
  jobId: string,
  signal: AbortSignal | undefined
): Promise<{ ok: true; json: ExpandResponseJson } | { ok: false; status: number; json: ExpandResponseJson | null }> {
  let lastStatus = 500;
  let lastJson: ExpandResponseJson | null = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await expandFetchConcurrency.acquire();
    let r: Response;
    const attemptSignal = combinedSignal(signal, EXPAND_FETCH_TIMEOUT_MS);
    try {
      r = await fetch("/api/process-pdf/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
        signal: attemptSignal.signal,
        cache: "no-store",
      });
    } catch {
      attemptSignal.cancel();
      expandFetchConcurrency.release();
      if (signal?.aborted) return { ok: false, status: 0, json: null };
      if (attempt < 14) {
        await sleep(Math.min(12_000, 800 + attempt * 1_000));
        continue;
      }
      return { ok: false, status: 0, json: null };
    }
    let raw: string;
    try {
      raw = await r.text();
    } finally {
      attemptSignal.cancel();
      expandFetchConcurrency.release();
    }
    lastStatus = r.status;
    let parsed: ExpandResponseJson | null = null;
    try {
      parsed = JSON.parse(raw) as ExpandResponseJson;
    } catch {
      parsed = null;
    }
    lastJson = parsed;
    if (r.ok) {
      if (!parsed) {
        return { ok: false, status: r.status, json: null };
      }
      return { ok: true, json: parsed };
    }
    const retryable =
      r.status === 429 ||
      TRANSIENT_HTTP.has(r.status) ||
      (r.status === 400 &&
        typeof parsed?.error === "string" &&
        /rate|429|throttl|overloaded|timeout/i.test(parsed.error));
    if (retryable && attempt < 14) {
      const delayMs =
        r.status === 429
          ? Math.min(90_000, 14_000 + attempt * 9_000)
          : Math.min(55_000, 2_200 + attempt * 4_500);
      await sleep(delayMs);
      continue;
    }
    return { ok: false, status: lastStatus, json: lastJson };
  }
  return { ok: false, status: lastStatus, json: lastJson };
}

/** Latest server row fields from `GET /jobs/:id` (each poll). Use for multi-PDF UI so tab order stays upload order while previews land in completion order. */
export type PollPdfIngestJobSnapshot = {
  status: string;
  outlineReady: boolean;
  ingestPhase?: PdfIngestPhase;
  ingestTranscript?: string;
  modulesBuilt?: number;
  modulesTotal?: number;
};

export type PollPdfIngestOptions = {
  signal?: AbortSignal;
  /** Max time to keep polling + triggering expands for this job (default suits large decks + rate limits). */
  maxWaitMs?: number;
  /** Latest Claude output tail while the model streams (outline / module JSON). */
  onStreamPreview?: (text: string | null) => void;
  /** Merged course preview (outline + partial modules) for the study-style live UI. */
  onPreviewCourse?: (course: CoursePayload | null) => void;
  /** Fires after every successful job GET parse (status, outline gate, module counts). */
  onJobSnapshot?: (snapshot: PollPdfIngestJobSnapshot) => void;
};

/** One job can exceed 15m under TPM throttling, many modules, or cold starts — keep UI driving `/expand`. */
const DEFAULT_POLL_MAX_WAIT_MS = 55 * 60 * 1000;

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
  const maxWait =
    typeof options?.maxWaitMs === "number" &&
    Number.isFinite(options.maxWaitMs) &&
    options.maxWaitMs >= 60_000
      ? options.maxWaitMs
      : DEFAULT_POLL_MAX_WAIT_MS;
  const deadline = Date.now() + maxWait;
  /** Monotonic high-water mark for built modules across the whole poll. */
  let builtHighWater = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { error: "Cancelled." };
    }
    const got = await fetchJobStatusWithRetry(jobId, signal);
    if (got.kind === "fatal") {
      return { error: got.error };
    }
    if (got.kind === "soft") {
      onProgress?.({
        line: "Waiting for status from the server after a brief hiccup…",
        bar: "indeterminate",
      });
      await sleep(2_500);
      continue;
    }

    const { data } = got;

    const snapStatus = typeof data.status === "string" ? data.status : "unknown";
    const rawPhase = data.ingestPhase;
    const ingestPhase: PdfIngestPhase | undefined =
      rawPhase === "reading_pdf" ||
      rawPhase === "reading_full_pdf" ||
      rawPhase === "digesting_full_pdf" ||
      rawPhase === "planning_preview" ||
      rawPhase === "planning_outline" ||
      rawPhase === "enriching_sources" ||
      rawPhase === "writing_modules" ||
      rawPhase === "reviewing_transcript" ||
      rawPhase === "transcribing"
        ? rawPhase
        : undefined;
    const ingestTranscript =
      typeof data.ingestTranscript === "string" ? data.ingestTranscript : undefined;
    options?.onJobSnapshot?.({
      status: snapStatus,
      outlineReady: Boolean(data.outlineReady),
      ingestPhase,
      ingestTranscript,
      modulesBuilt:
        typeof data.modulesBuilt === "number" ? data.modulesBuilt : undefined,
      modulesTotal:
        typeof data.modulesTotal === "number" ? data.modulesTotal : undefined,
    });

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
      return { error: data.error ?? "Build failed." };
    }

    if (ingestPhase === "reviewing_transcript") {
      onProgress?.({
        line: "Review the transcript below, fix any errors, then continue.",
        bar: null,
      });
      await sleep(2_000);
      continue;
    }

    if (ingestPhase === "digesting_full_pdf") {
      onProgress?.({
        line: "Preparing your notes and transcript for the course…",
        bar: "indeterminate",
      });
      if (!signal?.aborted) {
        void fetch("/api/process-pdf/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
          signal,
        }).catch(() => {});
      }
      await sleep(8_000);
      continue;
    }

    // Drive `POST /expand`:
    // built === total but job is still `running` (server saves all modules then finalizes;
    // if the client never got the completion response from the last module expand, or
    // finalize lagged, GET can sit at N/N + running — without another expand the UI
    // would spin on "Writing module N of N" forever).
    const builtRaw = data.modulesBuilt;
    if (typeof builtRaw === "number") {
      builtHighWater = Math.max(builtHighWater, builtRaw);
    }
    const built = builtRaw;
    const total = data.modulesTotal;
    if (ingestPhase === "enriching_sources") {
      const started = jobStartedAtMs(data.createdAt);
      const elapsedPart =
        started != null
          ? ` · ${formatElapsedShort(Date.now() - started)}`
          : "";
      onProgress?.({
        line: `Extracting tables and figures from your PDF pages…${elapsedPart}`,
        bar: "indeterminate",
      });
      await sleep(1_200);
      continue;
    }

    const inModulePhase =
      data.status === "running" &&
      ingestPhase === "writing_modules" &&
      data.outlineReady &&
      typeof built === "number" &&
      typeof total === "number" &&
      total > 0 &&
      built <= total;

    if (inModulePhase && built < total) {
      const expandResult = await pollJobProgressWhileExpandRuns(
        jobId,
        signal,
        {
          createdAt: data.createdAt,
          modulesTotal: total,
          modulesBuiltStart: Math.max(built, builtHighWater),
          onProgress,
          onJobSnapshot: options?.onJobSnapshot,
          onPreviewCourse: options?.onPreviewCourse,
          onStreamPreview: options?.onStreamPreview,
        },
        postProcessPdfExpand(jobId, signal)
      );

      if (!expandResult.ok && expandResult.status === 0) {
        if (signal?.aborted) return { error: "Cancelled." };
        const startedReconnect = jobStartedAtMs(data.createdAt);
        const elapsed =
          startedReconnect != null
            ? ` · ${formatElapsedShort(Date.now() - startedReconnect)}`
            : "";
        onProgress?.({
          line: `Writing modules… · ${built}/${total} built${elapsed} — reconnecting…`,
          bar: "indeterminate",
        });
        await sleep(3_200);
        continue;
      }
      const expJson = expandResult.ok
        ? expandResult.json
        : (expandResult.json ?? {});
      if (!expandResult.ok) {
        return {
          error:
            typeof expJson.error === "string" && expJson.error.trim()
              ? expJson.error.trim()
              : `Module batch failed (${expandResult.status}).`,
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
        // Keep the count monotonic across iterations (never regress the display).
        builtHighWater = Math.max(builtHighWater, expJson.modulesBuilt);
        onProgress?.({
          line: `Built ${builtHighWater}/${expJson.modulesTotal} modules${elapsedMid}. Continuing…`,
          bar: Math.min(
            100,
            (builtHighWater / expJson.modulesTotal) * 100
          ),
        });
      }
      await sleep(EXPAND_MODULE_GAP_MS);
      continue;
    }

    if (inModulePhase && built === total) {
      const started = jobStartedAtMs(data.createdAt);
      const label = `Saving your study set (${total} module${total === 1 ? "" : "s"})`;

      const liveTimerSave = setInterval(() => {
        if (signal?.aborted) return;
        const elapsed = started != null ? ` · ${formatElapsedShort(Date.now() - started)}` : "";
        onProgress?.({ line: `${label}…${elapsed}`, bar: 100 });
      }, 1_000);
      const elapsed0 = started != null ? ` · ${formatElapsedShort(Date.now() - started)}` : "";
      onProgress?.({ line: `${label}…${elapsed0}`, bar: 100 });

      const expandSave = await pollJobProgressWhileExpandRuns(
        jobId,
        signal,
        {
          createdAt: data.createdAt,
          modulesTotal: total,
          modulesBuiltStart: built,
          onProgress,
          onJobSnapshot: options?.onJobSnapshot,
          onPreviewCourse: options?.onPreviewCourse,
          onStreamPreview: options?.onStreamPreview,
        },
        postProcessPdfExpand(jobId, signal)
      );

      if (!expandSave.ok && expandSave.status === 0) {
        if (signal?.aborted) return { error: "Cancelled." };
        const elapsed = started != null ? ` · ${formatElapsedShort(Date.now() - started)}` : "";
        onProgress?.({
          line: `${label}…${elapsed} — reconnecting…`,
          bar: "indeterminate",
        });
        await sleep(3_200);
        continue;
      }
      const expJson = expandSave.ok
        ? expandSave.json
        : (expandSave.json ?? {});
      if (!expandSave.ok) {
        return {
          error:
            typeof expJson.error === "string" && expJson.error.trim()
              ? expJson.error.trim()
              : `Save step failed (${expandSave.status}).`,
        };
      }
      if (expJson.complete === true && typeof expJson.materialId === "string") {
        return { materialId: expJson.materialId };
      }
      await sleep(EXPAND_MODULE_GAP_MS);
      continue;
    }

    if (
      (data.status === "running" || data.status === "pending") &&
      !data.outlineReady
    ) {
      const started = jobStartedAtMs(data.createdAt);
      const elapsedPart =
        started != null
          ? ` · ${formatElapsedShort(Date.now() - started)}`
          : "";
      const streamPeek =
        typeof data.streamPreview === "string" && data.streamPreview.length > 20
          ? data.streamPreview
          : "";
      let phaseLine: string;
      if (data.status === "pending") {
        phaseLine =
          "Starting… (picking up your PDF now)";
      } else if (ingestPhase === "planning_outline") {
        phaseLine =
          streamPeek.length > 0
            ? "Step 2/2: Planning course outline with AI (receiving model output)…"
            : "Step 2/2: Planning course outline with AI (then writing each module)…";
      } else if (data.ingestPhase === "transcribing") {
        phaseLine =
          "Transcribing audio or video (this can take several minutes for long recordings)…";
      } else if (data.ingestPhase === "reviewing_transcript") {
        phaseLine = "Waiting for you to review the transcript…";
      } else if (ingestPhase === "reading_pdf") {
        phaseLine =
          "Step 1/2: Extracting content from your files (documents, slides, images, or media)…";
      } else if (streamPeek.length > 0) {
        phaseLine =
          "Step 2/2: Planning course outline with AI (receiving model output)…";
      } else {
        phaseLine =
          "Step 1/2: Extracting text from your PDF…";
      }
      onProgress?.({
        line: `${phaseLine}${elapsedPart}`,
        bar: "indeterminate",
      });

      // If the job is still pending, the original after() callback may have
      // been dropped or delayed. Call expand as a self-healing kick — the
      // expand route will re-trigger phase 1 if the job is still pending.
      // The kick is fire-and-forget; the next poll cycle will pick up progress.
      if (data.status === "pending" && !signal?.aborted) {
        void fetch("/api/process-pdf/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
          signal,
        }).catch(() => {});
      }
    }

    await sleep(450);
  }
  const waitedMin = Math.round(maxWait / 60_000);
  return {
    error: `Build is taking longer than expected (waited about ${waitedMin} minutes). Very large batches can still be running on the server — open the course again from the dashboard or use “Restart this PDF”. If this keeps happening, try fewer PDFs at once or a higher Anthropic usage tier (output tokens per minute).`,
  };
}
