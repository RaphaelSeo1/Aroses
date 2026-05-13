import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import pdfParse from "pdf-parse";
import { extractPdfTextHeadTail } from "@/lib/pdf-text-head-tail";
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
import {
  MAX_STUDY_PDF_BYTES,
  STUDY_PDF_INGEST_BUCKET,
} from "@/lib/study-pdf-ingest";
import {
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
  stripKnownDocumentExtension,
} from "@/lib/study-material-display-name";

async function removeIngestObject(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  storagePath: string
) {
  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove([storagePath])
    .catch(() => {});
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
  return Math.max(2_000, fromHeader ?? adjusted);
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
  storagePath: string,
  message: string
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "failed",
      error_message: truncateErr(message),
      stream_preview: null,
      ingest_phase: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  await removeIngestObject(admin, storagePath);
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
  storagePath: string,
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

/**
 * Before generating the outline, wait until fewer than `maxConcurrent` other jobs owned
 * by this user are in the AI-heavy phases ("planning_outline" or "writing_modules").
 * This prevents a 12-PDF batch from sending 12 simultaneous Anthropic requests and
 * rate-limiting them all into a slow backoff spiral.
 *
 * Uses a short random jitter so sibling jobs don't all wake and retry at the same instant.
 */
async function waitForOutlineSlot(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  userId: string,
  jobId: string,
  claimedEpoch: number
): Promise<boolean> {
  const maxConcurrent = Number.isFinite(
    Number(process.env.PDF_INGEST_MAX_CONCURRENT_OUTLINES)
  )
    ? Math.max(1, Math.trunc(Number(process.env.PDF_INGEST_MAX_CONCURRENT_OUTLINES)))
    : 3;
  const pollMs = 9_000;
  const deadline = Date.now() + 12 * 60_000;

  while (Date.now() < deadline) {
    const { count } = await admin
      .from("pdf_ingest_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("id", jobId)
      .eq("status", "running")
      .in("ingest_phase", ["planning_outline"]);

    if ((count ?? 0) < maxConcurrent) return true;

    if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) return false;

    await sleep(pollMs + Math.floor(Math.random() * 3_000));
  }

  return false;
}

function pdfIngestModuleBatchSize(remaining: number): number {
  const profile = process.env.COURSE_BUILD_PROFILE?.trim().toLowerCase();
  const defaultBatch = profile === "full" ? 1 : 2;
  const raw = process.env.PDF_INGEST_MODULE_BATCH_SIZE?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : defaultBatch;
  const safe = Number.isFinite(parsed) ? parsed : defaultBatch;
  return Math.max(1, Math.min(3, remaining, Math.trunc(safe)));
}

async function finalizePdfIngest(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  courseId: string,
  examGroupId: string,
  storagePath: string,
  originalFileName: string | null,
  outline: CourseOutlinePayload,
  modulesRaw: CourseModule[]
): Promise<{ materialId: string } | null> {
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

  const { data: row, error: insErr } = await admin
    .from("study_materials")
    .insert({
      user_id: materialOwnerId,
      course_id: courseId,
      exam_group_id: examGroupId,
      file_name: storedFileName,
      summary: payload.description,
      key_concepts: [] as string[],
      questions: [] as unknown[],
      course_payload: payload,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

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

  await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "complete",
      material_id: row.id,
      stream_preview: null,
      ingest_phase: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await removeIngestObject(admin, storagePath);

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
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, status, material_id, error_message, ingest_source_text, ingest_outline, ingest_modules, ingest_epoch"
    )
    .eq("id", jobId)
    .maybeSingle();

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

  let outline: CourseOutlinePayload;
  try {
    outline = parseCourseOutlinePayload(job.ingest_outline as unknown);
  } catch (e) {
    console.error("[pdf-ingest] bad ingest_outline", jobId, e);
    await failJobUnlessStale(
      admin,
      jobId,
      job.storage_path,
      "Stored course outline was invalid. Try uploading the PDF again.",
      expandEpoch
    );
    return { kind: "failed", message: "Invalid stored outline." };
  }

  const storagePath = job.storage_path;
  let modulesBuilt: CourseModule[];
  try {
    modulesBuilt = parseStoredModules(job.ingest_modules);
  } catch (e) {
    console.error("[pdf-ingest] corrupt ingest_modules", jobId, e);
    await failJobUnlessStale(
      admin,
      jobId,
      storagePath,
      "Saved module data was invalid. Try uploading the PDF again.",
      expandEpoch
    );
    return { kind: "failed", message: "Saved module data was invalid." };
  }

  const n = outline.modules.length;
  const prefix = modulesBuilt.slice(0, n);

  if (prefix.length >= n) {
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.course_id,
      job.exam_group_id,
      storagePath,
      job.original_file_name,
      outline,
      prefix
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

  const batchCount = pdfIngestModuleBatchSize(n - idx);
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
              offset === 0 ? createPdfStreamSink(admin, jobId) : undefined
            ),
          { maxAttempts: 12 }
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
    await failJobUnlessStale(admin, jobId, storagePath, message, expandEpoch);
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
      storagePath,
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
      storagePath,
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
      storagePath,
      job.original_file_name,
      outline,
      cappedNext
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
 * Client then calls `POST /api/process-pdf/expand` (or dev runs `runPdfIngestExpandOne` in a loop).
 */
export async function runPdfIngestJob(jobId: string): Promise<void> {
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
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, ingest_epoch"
    )
    .maybeSingle();

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

  let buf: Buffer;
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .download(storagePath);

    if (dlErr || !blob) {
      console.error("[pdf-ingest] download", jobId, dlErr);
      await failJobUnlessStale(
        admin,
        jobId,
        storagePath,
        "Could not read the uploaded PDF from storage. Try uploading again.",
        claimedEpoch
      );
      return;
    }

    buf = Buffer.from(await blob.arrayBuffer());
  } catch (e) {
    console.error("[pdf-ingest] download unexpected", jobId, e);
    await failJobUnlessStale(
      admin,
      jobId,
      storagePath,
      "Could not read the uploaded PDF from storage.",
      claimedEpoch
    );
    return;
  }

  await touchJobProgress(admin, jobId);

  if (buf.length > MAX_STUDY_PDF_BYTES) {
    await failJobUnlessStale(
      admin,
      jobId,
      storagePath,
      "PDF is too large for this server (max 40 MB). Split the file or export fewer pages.",
      claimedEpoch
    );
    return;
  }

  console.info("[pdf-ingest] start", {
    jobId,
    bytes: buf.length,
    path: storagePath.slice(0, 80),
  });

  let text = "";
  const maxPagesRaw = process.env.PDF_INGEST_MAX_PAGES?.trim();
  const maxPages = maxPagesRaw ? Number(maxPagesRaw) : 60;
  const safeMaxPages =
    Number.isFinite(maxPages) && maxPages >= 1 && maxPages <= 400
      ? Math.floor(maxPages)
      : 60;

  /** Head+tail page text extraction (see `extractPdfTextHeadTail`). Unrelated to `COURSE_BUILD_PROFILE`. */
  const useHeadTailPdfExtract =
    process.env.PDF_INGEST_FAST_EXTRACT?.trim() !== "0";

  let usedHeadTailPdfExtract = false;
  if (useHeadTailPdfExtract) {
    try {
      const extracted = await extractPdfTextHeadTail(buf, {
        onHeartbeat: () => touchJobProgress(admin, jobId),
      });
      if (extracted.text.length >= 80) {
        text = extracted.text;
        usedHeadTailPdfExtract = true;
        console.info("[pdf-ingest] extract", {
          jobId,
          numpages: extracted.numpages,
          skippedMiddle: extracted.skippedMiddle,
          chars: text.length,
        });
      }
    } catch (e) {
      console.warn(
        "[pdf-ingest] head-tail PDF extract failed; falling back to pdf-parse",
        jobId,
        e
      );
    }
  }

  if (!usedHeadTailPdfExtract) {
    try {
      const parsed = await pdfParse(buf, { max: safeMaxPages });
      text = (parsed.text ?? "").trim();
    } catch {
      await failJobUnlessStale(
        admin,
        jobId,
        storagePath,
        "Could not read PDF. Try another file.",
        claimedEpoch
      );
      return;
    }
  }

  if (text.length < 80) {
    await failJobUnlessStale(
      admin,
      jobId,
      storagePath,
      "Not enough text extracted from this PDF. Try slides with selectable text or another file.",
      claimedEpoch
    );
    return;
  }

  await touchJobProgress(admin, jobId);

  const storedMaterial = materialTextForPdfIngest(text);

  if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) {
    return;
  }

  const gotSlot = await waitForOutlineSlot(
    admin,
    claimed.user_id,
    jobId,
    claimedEpoch
  );
  if (!gotSlot) {
    console.info("[pdf-ingest] outline slot wait timed out or job restarted", jobId);
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

  let outline: CourseOutlinePayload;
  const streamSink = createPdfStreamSink(admin, jobId);
  const heartbeat = setInterval(() => {
    void touchJobProgress(admin, jobId);
  }, 25_000);
  try {
    outline = await withAnthropicRateLimitRetries(jobId, "outline", () =>
      generateCourseOutlineFromMaterial(text, streamSink)
    );
  } catch (e) {
    if (await isStaleIngestEpoch(admin, jobId, claimedEpoch)) {
      return;
    }
    const message = mapAiFailureToMessage(jobId, e);
    await failJobUnlessStale(admin, jobId, storagePath, message, claimedEpoch);
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
      storagePath,
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
      storagePath,
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
}
