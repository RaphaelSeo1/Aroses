import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import {
  extractContentForIngestJob,
  removeIngestObjects,
  type IngestSourceFileRef,
} from "@/lib/study-ingest/job-extract";
import {
  parseCourseModule,
  parseCourseOutlinePayload,
  renumberModules,
} from "@/lib/ai/course-payload";
import type { CourseModule } from "@/types/course";
import type { CourseOutlinePayload } from "@/lib/ai/course-payload";
import type { CoursePayload } from "@/types/course";
import {
  generateCourseModuleFromMaterial,
  generateCourseOutlineFromMaterial,
  materialTextForPdfIngest,
  type PdfIngestStreamSink,
} from "@/lib/ai/study-generation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import {
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
  stripKnownDocumentExtension,
} from "@/lib/study-material-display-name";

function normalizeStoragePaths(storagePath: string | string[]): string[] {
  return Array.isArray(storagePath) ? storagePath : [storagePath];
}

async function removeIngestObject(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  storagePath: string | string[],
  options?: { retainStorage?: boolean }
) {
  await removeIngestObjects(
    admin,
    normalizeStoragePaths(storagePath),
    Boolean(options?.retainStorage)
  );
}

function truncateErr(msg: string, max = 400): string {
  const t = msg.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetriableAnthropicRateLimit(e: unknown): boolean {
  return (
    e instanceof RateLimitError ||
    (e instanceof APIError &&
      typeof e.status === "number" &&
      (e.status === 429 || e.status === 503 || e.status === 529))
  );
}

function anthropic429BodyText(e: unknown): string {
  if (e instanceof APIError) {
    const err = e.error;
    if (err && typeof err === "object") {
      try {
        return JSON.stringify(err);
      } catch {
        /* ignore */
      }
    }
    return e.message ?? "";
  }
  if (e instanceof Error) return e.message;
  return "";
}

function backoffMsAfterRateLimit(e: unknown, attemptIndex: number): number {
  let fromHeader: number | null = null;
  if (e instanceof APIError && e.headers && typeof e.headers.get === "function") {
    const ra = e.headers.get("retry-after");
    if (ra) {
      const sec = Number(ra);
      if (Number.isFinite(sec) && sec > 0) {
        fromHeader = Math.min(120_000, Math.round(sec * 1000));
      }
    }
  }
  const body = anthropic429BodyText(e);
  const tokenTpmHeavy =
    /output tokens per minute|input tokens per minute|tokens per minute/i.test(
      body
    );
  const exp = Math.min(90_000, 2_000 * 2 ** attemptIndex);
  const adjusted = tokenTpmHeavy ? Math.max(exp, 28_000 + attemptIndex * 6_000) : exp;
  const base = Math.max(2_000, fromHeader ?? adjusted);
  // Add random jitter (0–4 s) so parallel jobs that all hit 429 at the same
  // instant don't all retry simultaneously and collide again.
  const jitter = Math.random() * 4_000;
  return Math.round(base + jitter);
}

/** Anthropic 429 / overload responses are common when many PDFs expand modules together — retry before failing the job. */
async function withAnthropicRateLimitRetries<T>(
  jobId: string,
  phase: string,
  fn: () => Promise<T>,
  options?: { maxAttempts?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetriableAnthropicRateLimit(e) || attempt === maxAttempts - 1) {
        throw e;
      }
      const delayMs = backoffMsAfterRateLimit(e, attempt);
      console.warn("[pdf-ingest] rate limit, backing off", {
        jobId,
        phase,
        attempt,
        delayMs,
      });
      await sleep(delayMs);
    }
  }
  throw new Error("[pdf-ingest] exhausted retries (unreachable)");
}

async function touchJobProgress(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", jobId);
}


async function pushJobStreamPreview(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  text: string
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({
      stream_preview: text,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function clearJobStreamPreview(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({
      stream_preview: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

function createPdfStreamSink(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
): PdfIngestStreamSink {
  return {
    push: (t) => pushJobStreamPreview(admin, jobId, t),
    clear: () => clearJobStreamPreview(admin, jobId),
  };
}

async function failJob(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  storagePath: string | string[],
  message: string,
  options?: { retainStorage?: boolean }
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "failed",
      error_message: truncateErr(message),
      stream_preview: null,
      ingest_phase: null,
      ingest_preview_outline: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  await removeIngestObject(admin, storagePath, options);
}

/** True if another restart bumped `ingest_epoch` — this invocation must not write or delete storage. */
async function isStaleIngestEpoch(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  expected: number
): Promise<boolean> {
  const { data } = await admin
    .from("pdf_ingest_jobs")
    .select("ingest_epoch")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return true;
  const cur =
    typeof (data as { ingest_epoch?: unknown }).ingest_epoch === "number"
      ? (data as { ingest_epoch: number }).ingest_epoch
      : 0;
  if (cur !== expected) {
    console.info("[pdf-ingest] stale ingest_epoch; abandoning", {
      jobId,
      expected,
      cur,
    });
    return true;
  }
  return false;
}

async function failJobUnlessStale(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  storagePath: string | string[],
  message: string,
  claimedEpoch: number
): Promise<void> {
  if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) return;
  await failJob(admin, jobId, storagePath, message);
}

function mapAiFailureToMessage(jobId: string, e: unknown): string {
  console.error("[pdf-ingest] AI", jobId, e);
  if (e instanceof APIUserAbortError) {
    return "The AI request was stopped or hit a time limit. Try again, or upload fewer PDFs at once.";
  }
  if (e instanceof APIConnectionTimeoutError) {
    return "The AI request timed out. Try again on a stable network, or use a smaller PDF.";
  }
  if (e instanceof RateLimitError) {
    return "The AI service rate limit was hit. Wait one minute and try again.";
  }
  if (e instanceof APIError && typeof e.status === "number") {
    if (e.status === 404) {
      return "The configured AI model is not available (404). Update ANTHROPIC_COURSE_MODEL or redeploy — fast profile uses Claude Haiku 4.5.";
    }
    if (e.status === 529 || e.status === 503) {
      return "The AI service is temporarily overloaded. Try again in a few minutes.";
    }
    if (e.status === 429) {
      return "Too many AI requests right now. Wait a minute and retry this file.";
    }
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "Missing ANTHROPIC_API_KEY") {
    return "Server is not configured for AI. Contact support.";
  }
  if (msg.includes("Claude did not return valid JSON")) {
    return "The model returned an incomplete response. Try uploading again, or use a smaller PDF.";
  }
  return "AI processing failed (network or model timeout). Try again in a moment.";
}

function parseStoredModules(raw: unknown): CourseModule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => parseCourseModule(m));
}

function storagePathsForJob(job: {
  storage_path: string;
  source_files?: unknown;
}): string[] {
  if (Array.isArray(job.source_files)) {
    const paths = job.source_files
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const p = (item as { storagePath?: unknown }).storagePath;
        return typeof p === "string" ? p : null;
      })
      .filter((p): p is string => Boolean(p));
    if (paths.length > 0) return paths;
  }
  return [job.storage_path];
}


function pdfIngestModuleBatchSize(remaining: number, peerCount: number): number {
  // Module concurrency vs Anthropic TPM trade-off:
  //   - Solo PDF (peerCount=0): write 2 modules in parallel — Tier 1 Haiku
  //     output TPM (~16 k/min) comfortably absorbs 2× ~5 k-token streams. ~2×
  //     speedup on module writing for a typical 4-module course.
  //   - 1+ peers: fall back to 1 per call so concurrent calls = number of PDFs.
  //     Without this, N PDFs × batch≥2 = ≥2N concurrent streams → instant TPM
  //     ceiling → 60-90 s 429 backoffs that erase any speedup.
  //   - Env override (`PDF_INGEST_MODULE_BATCH_SIZE`) bypasses the heuristic
  //     when you've upgraded to Tier 2/3/4 and want to crank concurrency.
  const raw = process.env.PDF_INGEST_MODULE_BATCH_SIZE?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const fromEnv = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  const target = fromEnv != null ? fromEnv : peerCount === 0 ? 2 : 1;
  return Math.max(1, Math.min(remaining, target));
}

async function finalizePdfIngest(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  courseId: string,
  examGroupId: string,
  storagePath: string | string[],
  originalFileName: string | null,
  outline: CourseOutlinePayload,
  modulesRaw: CourseModule[],
  options?: {
    retainStorage?: boolean;
    ingestMedia?: Record<string, unknown> | null;
  }
): Promise<{ materialId: string } | null> {
  // Idempotency guard: if a concurrent expand call (e.g. from a page refresh)
  // already finalized this job, return the existing materialId instead of
  // inserting a duplicate study_materials row.
  const { data: alreadyDone } = await admin
    .from("pdf_ingest_jobs")
    .select("status, material_id")
    .eq("id", jobId)
    .maybeSingle();
  if (alreadyDone?.status === "complete" && alreadyDone?.material_id) {
    return { materialId: alreadyDone.material_id as string };
  }

  const modules = renumberModules(modulesRaw);
  const payload: CoursePayload = {
    title: outline.title,
    description: outline.description,
    modules,
  };

  const { data: courseOwnerRow, error: ownerErr } = await admin
    .from("courses")
    .select("user_id")
    .eq("id", courseId)
    .maybeSingle();

  const materialOwnerId =
    typeof courseOwnerRow?.user_id === "string" &&
    courseOwnerRow.user_id.length > 0
      ? courseOwnerRow.user_id
      : null;

  if (ownerErr || !materialOwnerId) {
    console.error("[pdf-ingest] course owner for study_materials", jobId, ownerErr);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not resolve course owner for this upload."
    );
    return null;
  }

  /** Append after existing uploads so the list follows “first added first” (ascending sort_order). */
  const { data: maxRow } = await admin
    .from("study_materials")
    .select("sort_order")
    .eq("exam_group_id", examGroupId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder =
    typeof maxRow?.sort_order === "number" && Number.isFinite(maxRow.sort_order)
      ? maxRow.sort_order + 1
      : 0;

  const stemFromContent = deriveFileStemFromPayload(payload);
  const uploadLabel =
    typeof originalFileName === "string" && originalFileName.trim().length > 0
      ? originalFileName.trim()
      : "upload.pdf";
  const fromUploadStem =
    stripKnownDocumentExtension(uploadLabel) ||
    finalizeMaterialSectionLabel(uploadLabel);
  const storedFileName = stemFromContent
    ? finalizeMaterialSectionLabel(stemFromContent)
    : fromUploadStem.length > 0
      ? fromUploadStem
      : "Material";

  // Insert study_materials first, then atomically flip job status to `complete`
  // in a single UPDATE that also sets material_id. Doing both in one operation
  // avoids a window where status=complete but material_id=null (which would
  // leave the polling client spinning forever).
  const materialInsert: Record<string, unknown> = {
    user_id: materialOwnerId,
    course_id: courseId,
    exam_group_id: examGroupId,
    file_name: storedFileName,
    summary: payload.description,
    key_concepts: [] as string[],
    questions: [] as unknown[],
    course_payload: payload,
    sort_order: nextSortOrder,
  };
  if (options?.ingestMedia) {
    materialInsert.ingest_media = options.ingestMedia;
  }

  let { data: row, error: insErr } = await admin
    .from("study_materials")
    .insert(materialInsert as never)
    .select("id")
    .single();

  if (
    insErr &&
    options?.ingestMedia &&
    isMissingDbColumnError(insErr, "ingest_media")
  ) {
    const { ingest_media: _m, ...withoutMedia } = materialInsert;
    void _m;
    const retry = await admin
      .from("study_materials")
      .insert(withoutMedia as never)
      .select("id")
      .single();
    row = retry.data;
    insErr = retry.error;
  }

  if (insErr || !row) {
    console.error("[pdf-ingest] insert study_materials", jobId, insErr);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not save study material."
    );
    return null;
  }

  // Atomically claim completion. If the UPDATE matches 0 rows (status was no
  // longer `running` because a concurrent call or a retry won), delete the
  // orphan row we just inserted and return the winner's materialId.
  const { data: claimed } = await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "complete",
      material_id: row.id,
      stream_preview: null,
      ingest_phase: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "running")
    .select("id")
    .maybeSingle();

  if (claimed === null) {
    // Lost the race — delete the orphan material we inserted above.
    await admin
      .from("study_materials")
      .delete()
      .eq("id", row.id)
      .then(() => {}, () => {});

    const { data: winner } = await admin
      .from("pdf_ingest_jobs")
      .select("material_id")
      .eq("id", jobId)
      .maybeSingle();
    const winId = winner?.material_id;
    return typeof winId === "string" && winId.length > 0
      ? { materialId: winId }
      : null;
  }

  await removeIngestObject(admin, storagePath, {
    retainStorage: options?.retainStorage,
  });

  return { materialId: row.id };
}

export type PdfIngestExpandResult =
  | { kind: "complete"; materialId: string }
  | { kind: "failed"; message: string }
  | { kind: "progress"; modulesBuilt: number; modulesTotal: number };

/**
 * Append the next module (or finalize if already complete). Each call is intended to run
 * in its own serverless invocation so Anthropic stays under the host wall clock.
 */
export async function runPdfIngestExpandOne(
  jobId: string
): Promise<PdfIngestExpandResult> {
  const admin = createAdminClient();
  if (!admin) {
    return { kind: "failed", message: "Server storage is not configured." };
  }

  const { data: job, error: loadErr } = await admin
    .from("pdf_ingest_jobs")
    .select(
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, status, material_id, error_message, ingest_source_text, ingest_outline, ingest_modules, ingest_epoch, created_at, retain_storage, ingest_media, source_files"
    )
    .eq("id", jobId)
    .maybeSingle();

  // Prefer the per-upload context (set on the job row at upload time). Fall
  // back to the parent course's context so existing self-study sessions keep
  // working until the user customises individual lectures. The per-job
  // lookup is a separate query so older schemas (pre-migration 030 where
  // `study_context` doesn't exist on the table) still keep working — we
  // swallow the error and continue.
  let expandStudyContext: string | null = null;
  if (job?.id) {
    const { data: jobCtx } = await admin
      .from("pdf_ingest_jobs")
      .select("study_context")
      .eq("id", job.id)
      .maybeSingle();
    const raw = (jobCtx as { study_context?: unknown } | null | undefined)
      ?.study_context;
    if (typeof raw === "string" && raw.trim().length > 0) {
      expandStudyContext = raw.trim();
    }
  }
  if (!expandStudyContext && job?.course_id) {
    const { data: courseCtx } = await admin
      .from("courses")
      .select("study_context")
      .eq("id", job.course_id)
      .maybeSingle();
    const raw = courseCtx?.study_context;
    expandStudyContext =
      typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  }

  if (loadErr || !job) {
    return { kind: "failed", message: "Job not found." };
  }

  if (job.status === "complete" && job.material_id) {
    return { kind: "complete", materialId: job.material_id };
  }

  if (job.status === "failed") {
    const em =
      typeof job.error_message === "string" && job.error_message.trim()
        ? job.error_message.trim()
        : "PDF build failed.";
    return { kind: "failed", message: em };
  }

  if (job.status !== "running") {
    return { kind: "failed", message: "Job is not ready to expand yet." };
  }

  if (job.ingest_outline == null || job.ingest_source_text == null) {
    return {
      kind: "failed",
      message:
        "Chunked ingest columns missing or outline not ready. Apply migration 021_pdf_ingest_chunked.sql and try again.",
    };
  }

  const expandEpoch =
    typeof (job as { ingest_epoch?: unknown }).ingest_epoch === "number"
      ? (job as { ingest_epoch: number }).ingest_epoch
      : 0;

  const storagePaths = storagePathsForJob(job);

  let outline: CourseOutlinePayload;
  try {
    outline = parseCourseOutlinePayload(job.ingest_outline as unknown);
  } catch (e) {
    console.error("[pdf-ingest] bad ingest_outline", jobId, e);
    await failJobUnlessStale(
      admin,
      jobId,
      storagePaths,
      "Stored course outline was invalid. Try uploading again.",
      expandEpoch
    );
    return { kind: "failed", message: "Invalid stored outline." };
  }
  let modulesBuilt: CourseModule[];
  try {
    modulesBuilt = parseStoredModules(job.ingest_modules);
  } catch (e) {
    console.error("[pdf-ingest] corrupt ingest_modules", jobId, e);
    await failJobUnlessStale(
      admin,
      jobId,
      storagePaths,
      "Saved module data was invalid. Try uploading again.",
      expandEpoch
    );
    return { kind: "failed", message: "Saved module data was invalid." };
  }

  const n = outline.modules.length;
  const prefix = modulesBuilt.slice(0, n);

  const retainStorage = Boolean(
    (job as { retain_storage?: unknown }).retain_storage
  );
  const ingestMedia =
    (job as { ingest_media?: unknown }).ingest_media &&
    typeof (job as { ingest_media?: unknown }).ingest_media === "object"
      ? ((job as { ingest_media: Record<string, unknown> }).ingest_media)
      : null;

  if (prefix.length >= n) {
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.course_id,
      job.exam_group_id,
      storagePaths,
      job.original_file_name,
      outline,
      prefix,
      { retainStorage, ingestMedia }
    );
    if (!fin) {
      return { kind: "failed", message: "Could not save study material." };
    }
    return { kind: "complete", materialId: fin.materialId };
  }

  const idx = prefix.length;
  await touchJobProgress(admin, jobId);

  if (await isStaleIngestEpoch(admin, jobId, expandEpoch)) {
    return {
      kind: "failed",
      message:
        "This build was restarted. Refresh the page if this tab still looks stuck.",
    };
  }

  // FIFO queue for module generation, same shape as the outline queue in
  // `runPdfIngestJob`. Cap concurrent Anthropic module streams per user to
  // protect Tier 1 TPM. Earliest `created_at` goes first so the user sees
  // tabs finish in upload order (matches the UI's numbered list).
  const moduleConcurrencyEnv =
    process.env.PDF_INGEST_MODULE_CONCURRENCY?.trim();
  const moduleConcurrencyParsed = moduleConcurrencyEnv
    ? Number.parseInt(moduleConcurrencyEnv, 10)
    : Number.NaN;
  const MODULE_CONCURRENCY = Number.isFinite(moduleConcurrencyParsed)
    ? Math.max(1, Math.min(20, moduleConcurrencyParsed))
    : 3;
  const QUEUE_POLL_MS = 3_500;
  const QUEUE_MAX_WAIT_MS = 4 * 60 * 1000;

  const jobCreatedAt =
    typeof (job as { created_at?: unknown }).created_at === "string"
      ? (job as { created_at: string }).created_at
      : null;
  if (jobCreatedAt && job.user_id) {
    const queueStartedAt = Date.now();
    let loggedQueueEnter = false;
    while (Date.now() - queueStartedAt < QUEUE_MAX_WAIT_MS) {
      // Only count *live* competitors — see outline queue rationale.
      const recentCutoff = new Date(Date.now() - 45_000).toISOString();
      const { count: aheadOfMe } = await admin
        .from("pdf_ingest_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", job.user_id)
        .eq("status", "running")
        .eq("ingest_phase", "writing_modules")
        .lt("created_at", jobCreatedAt)
        .gt("updated_at", recentCutoff)
        .neq("id", jobId);
      const position = aheadOfMe ?? 0;
      if (position < MODULE_CONCURRENCY) break;
      if (!loggedQueueEnter) {
        console.info("[pdf-ingest] module queue wait", {
          jobId,
          position,
          concurrency: MODULE_CONCURRENCY,
        });
        loggedQueueEnter = true;
      }
      await touchJobProgress(admin, jobId);
      await sleep(QUEUE_POLL_MS);
      if (await isStaleIngestEpoch(admin, jobId, expandEpoch)) {
        return {
          kind: "failed",
          message:
            "This build was restarted. Refresh the page if this tab still looks stuck.",
        };
      }
    }
  }

  // Peer-aware batch size: how many *other* PDFs for this user are currently
  // writing modules? If zero, we can safely parallelize within this job.
  let modulePeerCount = 0;
  if (job.user_id) {
    const { count: peers } = await admin
      .from("pdf_ingest_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", job.user_id)
      .eq("ingest_phase", "writing_modules")
      .neq("id", jobId);
    modulePeerCount = peers ?? 0;
  }
  const batchCount = pdfIngestModuleBatchSize(n - idx, modulePeerCount);
  const batchIndices = Array.from({ length: batchCount }, (_, offset) => idx + offset);
  let newModules: CourseModule[];
  const moduleHeartbeat = setInterval(() => {
    void touchJobProgress(admin, jobId);
  }, 22_000);
  try {
    newModules = await Promise.all(
      batchIndices.map((moduleIndex, offset) =>
        withAnthropicRateLimitRetries(
          jobId,
          batchCount === 1 ? "module" : `module-${moduleIndex + 1}`,
          () =>
            generateCourseModuleFromMaterial(
              job.ingest_source_text,
              outline,
              moduleIndex,
              offset === 0 ? createPdfStreamSink(admin, jobId) : undefined,
              expandStudyContext ?? undefined
            ),
          // 6 attempts × 90 s exp-backoff cap = ~126 s worst-case retry +
          // ~30 s generation = ~156 s. Comfortably under Vercel's 300 s
          // maxDuration so /expand always returns cleanly to the client
          // (which has its own retry loop via polling). 16 here meant the
          // function would get force-killed mid-retry, the client would
          // reconnect, and the same module would be re-attempted from zero
          // — the UI looked stuck at "Writing module N of M" for minutes.
          { maxAttempts: 6 }
        )
      )
    );
  } catch (e) {
    if (await isStaleIngestEpoch(admin, jobId, expandEpoch)) {
      return {
        kind: "failed",
        message:
          "This build was restarted. Refresh the page if this tab still looks stuck.",
      };
    }
    const message = mapAiFailureToMessage(jobId, e);
    await failJobUnlessStale(admin, jobId, storagePaths, message, expandEpoch);
    return { kind: "failed", message };
  } finally {
    clearInterval(moduleHeartbeat);
  }

  const nextModules = [...prefix, ...newModules];
  const cappedNext = nextModules.slice(0, n);
  const { data: modRow, error: upErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      ingest_modules: nextModules,
      stream_preview: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("ingest_epoch", expandEpoch)
    .select("id")
    .maybeSingle();

  if (upErr) {
    console.error("[pdf-ingest] update ingest_modules", jobId, upErr);
    await failJobUnlessStale(
      admin,
      jobId,
      storagePaths,
      "Could not save module progress. Try uploading again.",
      expandEpoch
    );
    return { kind: "failed", message: "Could not save module progress." };
  }
  if (!modRow) {
    if (await isStaleIngestEpoch(admin, jobId, expandEpoch)) {
      return {
        kind: "failed",
        message:
          "This build was restarted. Refresh the page if this tab still looks stuck.",
      };
    }
    await failJobUnlessStale(
      admin,
      jobId,
      storagePaths,
      "Could not save module progress. Try uploading again.",
      expandEpoch
    );
    return { kind: "failed", message: "Could not save module progress." };
  }

  if (cappedNext.length >= n) {
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.course_id,
      job.exam_group_id,
      storagePaths,
      job.original_file_name,
      outline,
      cappedNext,
      { retainStorage, ingestMedia }
    );
    if (!fin) {
      return { kind: "failed", message: "Could not save study material." };
    }
    return { kind: "complete", materialId: fin.materialId };
  }

  return {
    kind: "progress",
    modulesBuilt: nextModules.length,
    modulesTotal: n,
  };
}

/**
 * Background phase 1: claim job → download PDF → extract text → course outline → DB.
 *
 * When `driveModules: true` is set the function also loops over all module
 * expansions inline (phase 2) so the full pipeline runs in a single server
 * invocation without requiring the browser client to be present.  Use this
 * in the initial `after()` call so uploads complete even when the user
 * navigates away before the client's polling loop kicks in.
 */
export async function runPdfIngestJob(
  jobId: string,
  options?: { driveModules?: boolean }
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("[pdf-ingest] missing SUPABASE_SERVICE_ROLE_KEY", jobId);
    return;
  }

  const { data: claimed, error: claimErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "running",
      ingest_phase: "reading_pdf",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select(
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, ingest_epoch, created_at"
    )
    .maybeSingle();

  // Fetch self-study context. Per-upload (job-level) overrides the
  // course-level default. Done after the claim so we don't delay the claim
  // itself; the context is only needed at outline time. Per-job lookup is a
  // separate query so older schemas (pre-migration 030) don't break.
  let courseStudyContext: string | null = null;
  if (claimed?.id) {
    const { data: jobCtxRow } = await admin
      .from("pdf_ingest_jobs")
      .select("study_context")
      .eq("id", claimed.id)
      .maybeSingle();
    const raw = (jobCtxRow as { study_context?: unknown } | null | undefined)
      ?.study_context;
    if (typeof raw === "string" && raw.trim().length > 0) {
      courseStudyContext = raw.trim();
    }
  }
  if (!courseStudyContext && claimed?.course_id) {
    const { data: courseRow } = await admin
      .from("courses")
      .select("study_context")
      .eq("id", claimed.course_id)
      .maybeSingle();
    const raw = courseRow?.study_context;
    courseStudyContext =
      typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  }

  if (claimErr) {
    console.error("[pdf-ingest] claim", jobId, claimErr);
    return;
  }
  if (!claimed) {
    return;
  }

  const storagePath = claimed.storage_path;

  const claimedEpoch =
    typeof (claimed as { ingest_epoch?: unknown }).ingest_epoch === "number"
      ? (claimed as { ingest_epoch: number }).ingest_epoch
      : 0;

  const t0 = Date.now();

  let sourceFiles: IngestSourceFileRef[] | null = null;
  const { data: filesRow } = await admin
    .from("pdf_ingest_jobs")
    .select("source_files")
    .eq("id", jobId)
    .maybeSingle();
  if (filesRow && Array.isArray((filesRow as { source_files?: unknown }).source_files)) {
    const parsed: IngestSourceFileRef[] = [];
    for (const item of (filesRow as { source_files: unknown[] }).source_files) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (typeof r.storagePath !== "string") continue;
      parsed.push({
        storagePath: r.storagePath,
        originalFileName:
          typeof r.originalFileName === "string" ? r.originalFileName : null,
        kind:
          typeof r.kind === "string"
            ? (r.kind as IngestSourceFileRef["kind"])
            : undefined,
      });
    }
    if (parsed.length > 0) sourceFiles = parsed;
  }

  const cleanupPaths =
    sourceFiles?.map((f) => f.storagePath) ?? [storagePath];

  console.info("[pdf-ingest] start", {
    jobId,
    path: storagePath.slice(0, 80),
    fileCount: sourceFiles?.length ?? 1,
  });

  const extractKeepAlive = setInterval(() => {
    void touchJobProgress(admin, jobId);
  }, 8_000);

  let previewResult: {
    text: string;
    numpages: number;
    skippedMiddle: boolean;
    retainStorage: boolean;
    ingestMedia: Record<string, unknown> | null;
  };

  try {
    const extracted = await extractContentForIngestJob({
      admin,
      jobId,
      primaryStoragePath: storagePath,
      primaryFileName: claimed.original_file_name,
      sourceFiles,
      onHeartbeat: () => touchJobProgress(admin, jobId),
      onPhase: async (phase) => {
        if (phase === "transcribing") {
          await admin
            .from("pdf_ingest_jobs")
            .update({
              ingest_phase: "transcribing",
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
      },
    });
    previewResult = {
      text: extracted.text,
      numpages: extracted.numpages,
      skippedMiddle: extracted.skippedMiddle,
      retainStorage: extracted.retainStorage,
      ingestMedia: extracted.ingestMedia,
    };

    await admin
      .from("pdf_ingest_jobs")
      .update({
        retain_storage: extracted.retainStorage,
        ingest_media: extracted.ingestMedia,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .then(() => {}, () => {});

    console.info("[pdf-ingest] extract ok", {
      jobId,
      chars: extracted.text.length,
      numpages: extracted.numpages,
      retainStorage: extracted.retainStorage,
    });

    await touchJobProgress(admin, jobId);
  } catch (e) {
    const msg =
      e instanceof Error && e.message.trim()
        ? e.message.trim()
        : "Could not process this file. Try another format or a smaller file.";
    await failJobUnlessStale(
      admin,
      jobId,
      cleanupPaths,
      msg,
      claimedEpoch
    );
    return;
  } finally {
    clearInterval(extractKeepAlive);
  }

  const sourceTextForOutline = previewResult.text;

  // Audio/video: pause for transcript review before outline generation.
  if (previewResult.ingestMedia) {
    if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) return;
    const { error: reviewErr } = await admin
      .from("pdf_ingest_jobs")
      .update({
        ingest_transcript: sourceTextForOutline,
        ingest_phase: "reviewing_transcript",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("ingest_epoch", claimedEpoch);
    if (!reviewErr) {
      console.info("[pdf-ingest] awaiting transcript review", { jobId });
      return;
    }
    if (isMissingDbColumnError(reviewErr, "ingest_transcript")) {
      console.warn(
        "[pdf-ingest] ingest_transcript column missing; skipping review pause",
        jobId
      );
    } else {
      console.error("[pdf-ingest] transcript review update", jobId, reviewErr);
    }
  }

  await runPdfIngestOutlinePhase(admin, {
    jobId,
    claimed,
    claimedEpoch,
    cleanupPaths,
    sourceTextForOutline,
    courseStudyContext,
    driveModules: options?.driveModules,
    t0,
  });
}

/**
 * Resume after the student confirms an audio/video transcript.
 */
export async function runPdfIngestContinueAfterTranscript(
  jobId: string,
  options?: { driveModules?: boolean }
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const { data: job } = await admin
    .from("pdf_ingest_jobs")
    .select(
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, ingest_epoch, created_at, ingest_transcript, source_files, status, ingest_phase"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.status !== "running") return;
  if ((job as { ingest_phase?: string }).ingest_phase !== "reviewing_transcript") {
    return;
  }

  const transcript =
    typeof (job as { ingest_transcript?: unknown }).ingest_transcript === "string"
      ? (job as { ingest_transcript: string }).ingest_transcript.trim()
      : "";
  if (transcript.length < 80) return;

  const claimedEpoch =
    typeof (job as { ingest_epoch?: unknown }).ingest_epoch === "number"
      ? (job as { ingest_epoch: number }).ingest_epoch
      : 0;

  const cleanupPaths = storagePathsForJob(job as { storage_path: string; source_files?: unknown });

  let courseStudyContext: string | null = null;
  const { data: jobCtxRow } = await admin
    .from("pdf_ingest_jobs")
    .select("study_context")
    .eq("id", jobId)
    .maybeSingle();
  const rawCtx = (jobCtxRow as { study_context?: unknown } | null)?.study_context;
  if (typeof rawCtx === "string" && rawCtx.trim()) {
    courseStudyContext = rawCtx.trim();
  } else if (job.course_id) {
    const { data: courseRow } = await admin
      .from("courses")
      .select("study_context")
      .eq("id", job.course_id)
      .maybeSingle();
    const raw = courseRow?.study_context;
    courseStudyContext =
      typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  }

  await runPdfIngestOutlinePhase(admin, {
    jobId,
    claimed: job,
    claimedEpoch,
    cleanupPaths,
    sourceTextForOutline: transcript,
    courseStudyContext,
    driveModules: options?.driveModules,
    t0: Date.now(),
  });
}

async function runPdfIngestOutlinePhase(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  input: {
    jobId: string;
    claimed: {
      user_id: string;
      created_at?: string;
    };
    claimedEpoch: number;
    cleanupPaths: string[];
    sourceTextForOutline: string;
    courseStudyContext: string | null;
    driveModules?: boolean;
    t0: number;
  }
): Promise<void> {
  const {
    jobId,
    claimed,
    claimedEpoch,
    cleanupPaths,
    sourceTextForOutline,
    courseStudyContext,
    driveModules,
    t0,
  } = input;

  const storedMaterial = materialTextForPdfIngest(sourceTextForOutline);

  if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) {
    return;
  }

  await admin
    .from("pdf_ingest_jobs")
    .update({
      ingest_phase: "planning_outline",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("ingest_epoch", claimedEpoch);

  // Concurrency queue for the streaming Anthropic outline call. Tier 1 Haiku
  // can run ~2-3 outlines in parallel before hitting input or output TPM
  // limits and forcing every job into 28-90 s 429 retry backoff. A FIFO queue
  // ordered by `created_at` gives deterministic, low-latency scheduling:
  // the first N PDFs proceed immediately, the rest wait until a slot frees.
  //
  // Total wall-clock for 9 PDFs ≈ ceil(9 / 3) * 30 s = 90 s, vs the previous
  // chaos where every job spent minutes in 429 retries.
  //
  // Override via `PDF_INGEST_OUTLINE_CONCURRENCY` (set higher on Tier 2/3/4).
  const concurrencyEnv = process.env.PDF_INGEST_OUTLINE_CONCURRENCY?.trim();
  const concurrencyParsed = concurrencyEnv
    ? Number.parseInt(concurrencyEnv, 10)
    : Number.NaN;
  const OUTLINE_CONCURRENCY = Number.isFinite(concurrencyParsed)
    ? Math.max(1, Math.min(20, concurrencyParsed))
    : 3;
  const QUEUE_POLL_MS = 3_500;
  const QUEUE_MAX_WAIT_MS = 6 * 60 * 1000;

  const myCreatedAt =
    typeof (claimed as { created_at?: unknown }).created_at === "string"
      ? (claimed as { created_at: string }).created_at
      : null;
  if (myCreatedAt && claimed.user_id) {
    const queueStartedAt = Date.now();
    let loggedQueueEnter = false;
    while (Date.now() - queueStartedAt < QUEUE_MAX_WAIT_MS) {
      // Only count *live* competitors: status=running AND updated_at within
      // the last ~45 s. Old test rows from previous sessions can have
      // ingest_phase='planning_outline' forever without ever being cleaned
      // up; without this filter those stale rows would block fresh uploads
      // from leaving the queue. Live workers heartbeat every ~8 s, so 45 s
      // is comfortable headroom.
      const recentCutoff = new Date(Date.now() - 45_000).toISOString();
      const { count: aheadOfMe } = await admin
        .from("pdf_ingest_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", claimed.user_id)
        .eq("status", "running")
        .eq("ingest_phase", "planning_outline")
        .lt("created_at", myCreatedAt)
        .gt("updated_at", recentCutoff)
        .neq("id", jobId);
      const position = aheadOfMe ?? 0;
      if (position < OUTLINE_CONCURRENCY) break;
      if (!loggedQueueEnter) {
        console.info("[pdf-ingest] outline queue wait", {
          jobId,
          position,
          concurrency: OUTLINE_CONCURRENCY,
        });
        loggedQueueEnter = true;
      }
      await touchJobProgress(admin, jobId);
      await sleep(QUEUE_POLL_MS);
      if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) {
        return;
      }
    }
  }

  const streamSink = createPdfStreamSink(admin, jobId);
  const heartbeat = setInterval(() => {
    void touchJobProgress(admin, jobId);
  }, 8_000);
  let outline: CourseOutlinePayload;
  try {
    outline = await withAnthropicRateLimitRetries(
      jobId,
      "outline",
      () =>
        generateCourseOutlineFromMaterial(
          sourceTextForOutline,
          streamSink,
          courseStudyContext ?? undefined
        ),
      { maxAttempts: 14 }
    );
  } catch (e) {
    if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) {
      return;
    }
    const message = mapAiFailureToMessage(jobId, e);
    await failJobUnlessStale(admin, jobId, cleanupPaths, message, claimedEpoch);
    return;
  } finally {
    clearInterval(heartbeat);
  }

  const { data: outlineRow, error: outlineErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      ingest_source_text: storedMaterial,
      ingest_outline: outline,
      ingest_modules: [],
      ingest_preview_outline: null,
      stream_preview: null,
      ingest_phase: "writing_modules",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("ingest_epoch", claimedEpoch)
    .select("id")
    .maybeSingle();

  if (outlineErr) {
    console.error("[pdf-ingest] persist outline", jobId, outlineErr);
    await failJobUnlessStale(
      admin,
      jobId,
      cleanupPaths,
      "Could not save outline. Apply migration 021_pdf_ingest_chunked.sql in Supabase, then try again.",
      claimedEpoch
    );
    return;
  }
  if (!outlineRow) {
    if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) {
      console.info("[pdf-ingest] outline persist skipped (restarted)", jobId);
      return;
    }
    await failJobUnlessStale(
      admin,
      jobId,
      cleanupPaths,
      "Could not save outline. Apply migration 021_pdf_ingest_chunked.sql in Supabase, then try again.",
      claimedEpoch
    );
    return;
  }

  console.info("[pdf-ingest] outline ok", {
    jobId,
    ms: Date.now() - t0,
    modules: outline.modules.length,
  });

  if (!driveModules) return;

  // Phase 2: drive all module expansions inline so the job completes without
  // the browser client needing to stay open (upload-and-leave support).
  // We loop until complete, failed, or a safety cap is reached. Each call to
  // runPdfIngestExpandOne claims and writes exactly one module batch then
  // returns, so even very large outlines advance safely within one invocation.
  const maxSteps = outline.modules.length + 6; // modules + a few finalize retries
  for (let step = 0; step < maxSteps; step++) {
    const r = await runPdfIngestExpandOne(jobId);
    if (r.kind === "complete") {
      console.info("[pdf-ingest] driveModules: complete", { jobId, step });
      break;
    }
    if (r.kind === "failed") {
      console.warn("[pdf-ingest] driveModules: failed", { jobId, step, message: r.message });
      break;
    }
    // Brief pause to avoid slamming Anthropic with back-to-back requests
    // from the same job while other parallel jobs are also generating modules.
    await sleep(300);
  }
}
