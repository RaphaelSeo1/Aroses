import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractContentForIngestJob,
  removeIngestObjects,
  type IngestSourceFileRef,
} from "@/lib/study-ingest/job-extract";
import {
  summarizeChunksForPlanner,
  type IngestChunk,
} from "@/lib/study-ingest/chunking";
import {
  attachLessonSources,
  parseIngestPlan,
  parsePersistedIngestChunks,
  persistIngestChunks,
  type SourceIndex,
} from "@/lib/source-attribution";
import { filterCroppedFiguresOnly } from "@/lib/study-ingest/source-images/is-page-render";
import { embedSourceImagesInModules } from "@/lib/study-ingest/source-images/embed-in-course";
import {
  enrichChunksWithPageFigures,
  enrichChunksWithPageTables,
} from "@/lib/study-ingest/enrich-chunks-with-page-tables";
import {
  collectPdfFiguresForModule,
  collectPdfTablesForModule,
  extractPdfTableBlocksFromSource,
  injectPageImagesFromLessonSources,
  injectUnplacedFiguresByRelevance,
  injectPdfArtifactsIntoModule,
  injectPdfArtifactsIntoModules,
  mergeIngestPageImageRecords,
  parseIngestPageArtifacts,
  type IngestPageArtifacts,
} from "@/lib/study-ingest/inject-pdf-tables-into-module";
import { pageTableExtractionsToMap } from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
import {
  isPdfTableVisionEnabled,
  supplementPdfTablesOnly,
} from "@/lib/study-ingest/supplement-pdf-tables";
import {
  buildCourseAssetManifest,
  formatAssetManifestForPrompt,
  mergeManifestWithDbAssets,
  parseCourseAssetManifest,
  resolveAssetTokensInModules,
  retrieveAssetsForModuleOutline,
  type CourseAssetManifest,
} from "@/lib/study-ingest/course-assets";
import { ensurePdfVisualsAtFinalize } from "@/lib/pdf-ingest/ensure-pdf-visuals";
import { enrichModulesWithPdfAssets } from "@/lib/pdf-ingest/enrich-modules-with-assets";
import { placeAllPdfAssetsIntoModules } from "@/lib/pdf-ingest/place-course-assets";
import {
  linkCourseAssetsToMaterial,
  loadCourseAssetsForJob,
} from "@/lib/pdf-ingest/persist-course-assets";
import { supplementPdfPageFigures } from "@/lib/study-ingest/source-images/supplement-pdf-pages";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import { parseIngestSourceImages } from "@/lib/study-ingest/source-images/upload";
import {
  parseCourseModule,
  parseCourseOutlinePayload,
  renumberModules,
} from "@/lib/ai/course-payload";
import type { CourseModule } from "@/types/course";
import type { CourseOutlinePayload } from "@/lib/ai/course-payload";
import type { CoursePayload } from "@/types/course";
import {
  assembleModuleSourcesFromPlan,
  generateCourseModuleFromMaterial,
  type ModuleGenerationOptions,
  generateCourseOutlineFromMaterial,
  buildMaterialDigestFromFullPdfText,
  materialTextForPdfIngest,
  planCourseStructureFromChunks,
  structurePlanToOutline,
  type PdfIngestStreamSink,
} from "@/lib/ai/study-generation";
import {
  courseContentLocaleToOutputLanguage,
  computeContentSourceKey,
  resolveCanonicalAndDisplayLocales,
} from "@/lib/course-canonical";
import type { CourseOutputLanguage } from "@/lib/course-output-language";
import { DEFAULT_COURSE_OUTPUT_LANGUAGE } from "@/lib/course-output-language";
import { loadCourseGenerationContext } from "@/lib/load-course-generation-context";
import {
  buildLocalizedCourseMaterial,
  coursePayloadToOutline,
  displayPayloadFromExistingCanonical,
  type LocalizedCourseMaterial,
} from "@/lib/localize-course-payload";
import { findSiblingCanonicalMaterial } from "@/lib/study-material-canonical";
import { lessonMarkdownHasImages } from "@/lib/lesson-content-layout";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { logActivity, pruneActivityEvents } from "@/lib/activity-log";
import {
  resolveMaterialSectionLabel,
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
} from "@/lib/study-material-display-name";
import {
  isGenericIngestPlaceholder,
  isWeakModuleTitle,
  resolveCourseDisplayTitle,
} from "@/lib/study-ingest/normalize-ingest-title";

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
  // Rate limit / overload — the original reason this wrapper existed.
  if (e instanceof RateLimitError) return true;
  // Transient network failures and timeouts. These are MUCH more common on the
  // longer-running streaming calls that larger PDFs produce (structure plan /
  // outline / module writing), and a single blip used to hard-fail the whole
  // job with the generic "(network or model timeout)" error even though a
  // retry almost always succeeds. APIConnectionTimeoutError extends
  // APIConnectionError, so this covers both. (Note: APIConnectionError has no
  // numeric `status`, so the APIError status branch below never caught it.)
  if (e instanceof APIConnectionError) return true;
  if (e instanceof APIError && typeof e.status === "number") {
    const s = e.status;
    // 408 request timeout, 500/502 transient server errors, 503/529 overloaded,
    // 429 rate limited — all worth a backoff + retry.
    return [408, 429, 500, 502, 503, 529].includes(s);
  }
  return false;
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
  // Connection drops / timeouts aren't rate limits — retry quickly rather than
  // sitting on the long token-budget backoff (which can blow the function's
  // time budget over several attempts). Short exponential with jitter.
  const isConnection =
    e instanceof APIConnectionError ||
    (e instanceof APIError &&
      typeof e.status === "number" &&
      [408, 500, 502].includes(e.status));
  if (isConnection) {
    const exp = Math.min(12_000, 1_500 * 2 ** attemptIndex);
    return Math.round(exp + Math.random() * 1_500);
  }

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
  // Connection drops / timeouts that survived the retry loop. Most common on
  // big PDFs whose AI calls run long. Distinct, accurate message.
  if (e instanceof APIConnectionError) {
    return "Lost the connection to the AI service partway through. This is usually temporary — try this file again in a moment.";
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
    if (e.status === 400) {
      const body = (e.message ?? "").toLowerCase();
      if (
        body.includes("too long") ||
        body.includes("maximum") ||
        body.includes("max_tokens") ||
        body.includes("context")
      ) {
        return "This document is too large for the AI to process in one pass. Split it into smaller sections (e.g. by chapter) and upload those.";
      }
    }
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "Missing ANTHROPIC_API_KEY") {
    return "Server is not configured for AI. Contact support.";
  }
  if (msg.includes("after module repair")) {
    return "One module was too large to finish in one AI pass (common with table-heavy PDFs). Click Restart this PDF — it usually succeeds on retry.";
  }
  if (
    msg.includes("Each module needs at least one") ||
    msg.includes("Invalid module") ||
    msg.includes("Each module needs at least one lesson")
  ) {
    return "The model returned an incomplete module (missing quiz or lessons). Click Restart this PDF — it usually succeeds on retry.";
  }
  if (msg.includes("Claude did not return valid JSON")) {
    return "The model returned an incomplete response. Click Restart this PDF — if it keeps failing, try splitting the PDF by chapter.";
  }
  if (msg.length > 0 && msg.length <= 200) {
    return msg;
  }
  return "AI processing failed (network or model timeout). Try again in a moment.";
}

type IndexedStoredModules = (CourseModule | null)[];

function parseStoredModulesIndexed(raw: unknown): IndexedStoredModules {
  if (!Array.isArray(raw)) return [];
  const out: IndexedStoredModules = [];
  for (const item of raw) {
    if (item == null) {
      out.push(null);
      continue;
    }
    try {
      out.push(parseCourseModule(item));
    } catch {
      out.push(null);
    }
  }
  return out;
}

function contiguousPrefixLength(modules: IndexedStoredModules): number {
  let i = 0;
  while (i < modules.length && modules[i] != null) i++;
  return i;
}

function moduleHasLessonContent(mod: CourseModule): boolean {
  return mod.lessons.some((l) => (l.content ?? "").trim().length > 0);
}

/** Modules with generated lesson bodies (may be out of order in `ingest_modules`). */
export function countIngestModulesBuilt(raw: unknown): number {
  return parseStoredModulesIndexed(raw).filter(
    (m): m is CourseModule => m != null && moduleHasLessonContent(m)
  ).length;
}

function parseStoredModules(raw: unknown): CourseModule[] {
  return parseStoredModulesIndexed(raw).filter(
    (m): m is CourseModule => m != null
  );
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
  // Module concurrency. TPM is now guarded globally by the DB-backed Claude
  // rate limiter (`acquireClaudeBudget`), so we no longer have to clamp to 1
  // when peers exist — the global budget absorbs the combined stream load and
  // backs off precisely when the org limit is near, instead of this heuristic
  // guessing. We still parallelize a couple of modules per call for speed.
  //   - Solo PDF (peerCount=0): up to 8 modules per /expand call (all modules
  //     when the outline has ≤8).
  //   - With peers: 4 per call (the limiter throttles if the org budget is hit).
  //   - Env override (`PDF_INGEST_MODULE_BATCH_SIZE`) wins when set.
  const raw = process.env.PDF_INGEST_MODULE_BATCH_SIZE?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const fromEnv = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  if (fromEnv != null) return Math.max(1, Math.min(remaining, fromEnv));
  if (peerCount === 0 && remaining <= 8) return remaining;
  const target = peerCount === 0 ? 8 : 4;
  return Math.max(1, Math.min(remaining, target));
}

async function loadIngestSourceIndex(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
): Promise<SourceIndex | null> {
  const { data, error } = await admin
    .from("pdf_ingest_jobs")
    .select("ingest_plan, ingest_chunks")
    .eq("id", jobId)
    .maybeSingle();

  if (
    error &&
    isMissingDbColumnError(error, "ingest_chunks", "ingest_plan")
  ) {
    return null;
  }

  const chunks = parsePersistedIngestChunks(
    (data as { ingest_chunks?: unknown } | null)?.ingest_chunks
  );
  if (chunks.length === 0) return null;

  const plan = parseIngestPlan(
    (data as { ingest_plan?: unknown } | null)?.ingest_plan
  );
  return plan ? { chunks, plan } : { chunks };
}

async function loadIngestPageArtifacts(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
): Promise<IngestPageArtifacts> {
  const { data, error } = await admin
    .from("pdf_ingest_jobs")
    .select("ingest_page_tables")
    .eq("id", jobId)
    .maybeSingle();
  if (error && isMissingDbColumnError(error, "ingest_page_tables")) {
    return { tables: {}, figures: [] };
  }
  return parseIngestPageArtifacts(
    (data as { ingest_page_tables?: unknown } | null)?.ingest_page_tables
  );
}

async function loadIngestAssetManifest(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
): Promise<CourseAssetManifest | null> {
  const { data, error } = await admin
    .from("pdf_ingest_jobs")
    .select("ingest_asset_manifest")
    .eq("id", jobId)
    .maybeSingle();
  if (error && isMissingDbColumnError(error, "ingest_asset_manifest")) {
    return null;
  }
  return parseCourseAssetManifest(
    (data as { ingest_asset_manifest?: unknown } | null)?.ingest_asset_manifest
  );
}

/**
 * Cap finalize's optional visual-extraction step at ~150 s (override with
 * `PDF_INGEST_FINALIZE_VISUAL_BUDGET_MS`). When this fallback runs it can
 * render + vision-crop up to 120 PDF pages, which on big decks blows past the
 * 300 s function budget — the worker is killed before it can flip the job to
 * `complete`, so the UI sits stuck at "Saving your study set" / N/N forever.
 * The course body is already fully built by this point; figures are a
 * best-effort enhancement, so we time-box them and always proceed to the
 * insert-material + flip-to-complete critical path.
 */
function finalizeVisualBudgetMs(): number {
  const raw = process.env.PDF_INGEST_FINALIZE_VISUAL_BUDGET_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 280_000) {
    return parsed;
  }
  return 60_000;
}

/**
 * Await `work`, but stop blocking after `ms` and return `fallback` instead. The
 * underlying promise is not cancellable (PDF render / vision crop), so it may
 * keep running until the function exits — we just no longer gate completion on
 * it. A rejection also yields `fallback` so an optional enrichment failure can
 * never abort finalize.
 */
async function withFinalizeBudget<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
  jobId: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[pdf-ingest] finalize step "${label}" exceeded ${ms}ms — completing without it`,
        jobId
      );
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([
      work.catch((e) => {
        console.error(`[pdf-ingest] finalize step "${label}" failed`, jobId, e);
        return fallback;
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    sourceImages?: IngestSourceImageRecord[];
    assetManifest?: CourseAssetManifest | null;
    sourceIndex?: SourceIndex | null;
    /** Pre-built canonical + display payloads (sibling reuse fast path). */
    localized?: LocalizedCourseMaterial;
    /** Required for canonical → translate when `localized` is omitted. */
    sourceText?: string;
    outputLanguage?: CourseOutputLanguage;
    knownPageCount?: number;
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

  const modulesRenumbered = renumberModules(modulesRaw);
  let pageArtifacts = await loadIngestPageArtifacts(admin, jobId);
  let sourceImagesForFinalize = options?.sourceImages ?? [];
  let assetManifest =
    options?.assetManifest ?? (await loadIngestAssetManifest(admin, jobId));

  const fallbackFileName =
    typeof originalFileName === "string" && originalFileName.trim().length > 0
      ? originalFileName.trim()
      : "upload.pdf";
  const primaryStoragePath = Array.isArray(storagePath)
    ? storagePath[0] ?? ""
    : storagePath;
  const isPdfUpload =
    /\.pdf$/i.test(fallbackFileName) || /\.pdf$/i.test(primaryStoragePath);

  if (
    isPdfUpload &&
    pageArtifacts.figures.filter((f) => f.url?.trim()).length === 0 &&
    primaryStoragePath
  ) {
    const { data: ownerRow } = await admin
      .from("courses")
      .select("user_id")
      .eq("id", courseId)
      .maybeSingle();
    const ownerId =
      typeof ownerRow?.user_id === "string" ? ownerRow.user_id : null;
    if (ownerId) {
      // Keep updated_at fresh while the (capped) visual fallback runs so the
      // GET-route finalize-stall recovery doesn't kick a competing finalize.
      const finalizeHeartbeat = setInterval(() => {
        void touchJobProgress(admin, jobId);
      }, 15_000);
      try {
        const ensured = await withFinalizeBudget(
          ensurePdfVisualsAtFinalize({
            admin,
            userId: ownerId,
            jobId,
            storagePath: primaryStoragePath,
            fileName: fallbackFileName,
            pageArtifacts,
            sourceImages: sourceImagesForFinalize,
            chunks: options?.sourceIndex?.chunks ?? [],
            plan: options?.sourceIndex?.plan ?? null,
            knownPageCount:
              options?.knownPageCount && options.knownPageCount > 0
                ? options.knownPageCount
                : undefined,
          }),
          finalizeVisualBudgetMs(),
          {
            pageArtifacts,
            sourceImages: sourceImagesForFinalize,
            manifest: null,
          },
          "ensurePdfVisualsAtFinalize",
          jobId
        );
        pageArtifacts = ensured.pageArtifacts;
        sourceImagesForFinalize = ensured.sourceImages;
        if (ensured.manifest) {
          assetManifest = ensured.manifest;
          await admin
            .from("pdf_ingest_jobs")
            .update({
              ingest_asset_manifest: ensured.manifest,
              ingest_page_tables: pageArtifacts,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .then(({ error }) => {
              if (
                error &&
                isMissingDbColumnError(
                  error,
                  "ingest_asset_manifest",
                  "ingest_page_tables"
                )
              ) {
                return { error: null };
              }
              return { error };
            }, () => ({ error: null }));
        }
      } catch (e) {
        console.error("[pdf-ingest] ensurePdfVisualsAtFinalize", jobId, e);
      } finally {
        clearInterval(finalizeHeartbeat);
      }
    }
  }

  const modulesWithArtifacts = injectPdfArtifactsIntoModules(
    modulesRenumbered,
    options?.sourceIndex?.plan ?? null,
    options?.sourceIndex?.chunks ?? [],
    pageArtifacts
  );

  const embedResult =
    sourceImagesForFinalize.length || options?.sourceImages?.length
      ? embedSourceImagesInModules(
          modulesWithArtifacts,
          sourceImagesForFinalize.length
            ? sourceImagesForFinalize
            : (options?.sourceImages ?? []),
          options?.sourceIndex ?? null
        )
      : { modules: modulesWithArtifacts, figuresIndex: null };

  const modulesWithSources =
    options?.sourceIndex && options.sourceIndex.chunks.length > 0
      ? attachLessonSources(
          embedResult.modules,
          options.sourceIndex.plan ?? null,
          options.sourceIndex.chunks,
          fallbackFileName
        )
      : embedResult.modules;

  const allPageImages = mergeIngestPageImageRecords(
    sourceImagesForFinalize,
    pageArtifacts
  );
  const modulesWithTokens = resolveAssetTokensInModules(
    injectPageImagesFromLessonSources(modulesWithSources, allPageImages),
    assetManifest
  );
  const modulesAfterFallback = await injectUnplacedFiguresByRelevance(
    modulesWithTokens,
    pageArtifacts.figures,
    assetManifest
  );

  let courseAssetsFromDb: Awaited<ReturnType<typeof loadCourseAssetsForJob>> = [];
  try {
    courseAssetsFromDb = await loadCourseAssetsForJob(admin, jobId);
  } catch (e) {
    console.error("[pdf-ingest] loadCourseAssetsForJob", jobId, e);
  }

  const placed = await placeAllPdfAssetsIntoModules(modulesAfterFallback, {
    manifest: assetManifest,
    pageArtifacts,
    courseAssets: courseAssetsFromDb,
    jobId,
  });

  let effectiveManifest = assetManifest;
  if (
    (!effectiveManifest || effectiveManifest.assets.length === 0) &&
    pageArtifacts.figures.length > 0
  ) {
    try {
      effectiveManifest = await buildCourseAssetManifest(pageArtifacts);
    } catch (e) {
      console.warn("[pdf-ingest] rebuild asset manifest at finalize", jobId, e);
    }
  }
  effectiveManifest = mergeManifestWithDbAssets(
    effectiveManifest,
    courseAssetsFromDb,
    fallbackFileName ?? "upload.pdf"
  );

  const pagesRendered = new Set(
    pageArtifacts.figures.map((f) => f.pageNum).filter((p) => p > 0)
  ).size;

  const modules = placed.modules;

  // Upgrade a placeholder course title (e.g. "Part 1", "Section 1", "Course")
  // using the real module titles the writer produced, then the upload name.
  if (isWeakModuleTitle(outline.title) || isGenericIngestPlaceholder(outline.title)) {
    const upgraded = resolveCourseDisplayTitle({
      planTitle: null,
      chunkTitles: modules.map((m) => m.title),
      uploadFileNames: originalFileName ? [originalFileName] : [],
    });
    if (upgraded && !isWeakModuleTitle(upgraded)) {
      outline = { ...outline, title: upgraded };
    }
  }

  const allLessons = modules.flatMap((m) => m.lessons);
  const lessonsWithVisualAssets = allLessons.filter(
    (l) => (l.visual_assets?.length ?? 0) > 0
  ).length;
  const lessonsWithImages = allLessons.filter((l) =>
    lessonMarkdownHasImages(l.content ?? "")
  ).length;
  const lessonsWithTables = allLessons.filter((l) => {
    const c = l.content ?? "";
    return c.includes("|") && /^\|.*\|/m.test(c);
  }).length;
  console.info("[pdf-ingest] finalize asset placement", {
    jobId,
    placeAvailable: placed.placeCounts.assetsAvailable,
    placeInjected: placed.placeCounts.assetsInjected,
    lessonsReceiving: placed.placeCounts.lessonsReceiving,
    pageImages: allPageImages.length,
    pagesRendered,
    lessonsWithVisualAssets,
    totalVisualsInserted: 0,
    lessonsWithImages,
    lessonsWithTables,
    manifestAssets: effectiveManifest?.assets.length ?? 0,
    pageTablePages: Object.keys(pageArtifacts.tables).length,
    pageFigures: pageArtifacts.figures.length,
  });

  let localizedMaterial = options?.localized;
  if (
    !localizedMaterial &&
    typeof options?.sourceText === "string" &&
    options.sourceText.trim().length > 0
  ) {
    localizedMaterial = await buildLocalizedCourseMaterial(
      outline,
      modules,
      options.sourceText,
      originalFileName,
      options.outputLanguage ?? DEFAULT_COURSE_OUTPUT_LANGUAGE
    );
  }

  const payload: CoursePayload = localizedMaterial
    ? localizedMaterial.display
    : {
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

  // Resolve this material's sidebar position so the section stays in UPLOAD
  // order even though parallel builds finalize out of order. Three tiers:
  //   1. `pdf_ingest_jobs.material_sort_order` snapshotted at job creation
  //      (count of prior materials + the build's upload index) — used when
  //      migration 076 is applied and the value persisted.
  //   2. Otherwise derive the position from sibling-job creation order below
  //      (works without any migration — the real-world path today).
  //   3. Last resort: append after the current max sort_order.
  let nextSortOrder: number | null = null;
  const { data: jobSortRow, error: jobSortErr } = await admin
    .from("pdf_ingest_jobs")
    .select("material_sort_order")
    .eq("id", jobId)
    .maybeSingle();
  if (
    !jobSortErr &&
    typeof (jobSortRow as { material_sort_order?: unknown } | null)
      ?.material_sort_order === "number" &&
    Number.isFinite(
      (jobSortRow as { material_sort_order: number }).material_sort_order
    )
  ) {
    nextSortOrder = (jobSortRow as { material_sort_order: number })
      .material_sort_order;
  }

  if (nextSortOrder === null) {
    // No persisted `material_sort_order` (e.g. migration 076 not applied).
    // Derive a stable upload-order position deterministically from the JOBS in
    // this section instead of from material completion order. Jobs are created
    // in upload order (the client creates them sequentially, so `created_at` is
    // monotonic), and one job produces one material — so this job's rank among
    // its sibling jobs by `(created_at, id)` equals its upload position,
    // regardless of which parallel build finishes first. This fixes the
    // "uploaded 1,2,3 → shows 1,3,2" scramble that `max(sort_order)+1` caused.
    const { data: siblingJobs } = await admin
      .from("pdf_ingest_jobs")
      .select("id, created_at")
      .eq("exam_group_id", examGroupId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (Array.isArray(siblingJobs) && siblingJobs.length > 0) {
      const rank = siblingJobs.findIndex(
        (j) => (j as { id?: unknown }).id === jobId
      );
      if (rank >= 0) nextSortOrder = rank;
    }
  }

  if (nextSortOrder === null) {
    /** Last resort: append after existing uploads (ascending sort_order). */
    const { data: maxRow } = await admin
      .from("study_materials")
      .select("sort_order")
      .eq("exam_group_id", examGroupId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    nextSortOrder =
      typeof maxRow?.sort_order === "number" && Number.isFinite(maxRow.sort_order)
        ? maxRow.sort_order + 1
        : 0;
  }

  const uploadLabel =
    typeof originalFileName === "string" && originalFileName.trim().length > 0
      ? originalFileName.trim()
      : "upload.pdf";
  // Prefer a label derived from the generated course content — the elaborate
  // AI summary of the PDF (e.g. "Master ionic bonding through electron
  // transfer…") that reads as a real topic, not the raw upload filename
  // ("L7 Slides"). Only fall back to the filename / outline title when the
  // content yields nothing usable.
  const stemFromContent = deriveFileStemFromPayload(payload);
  const storedFileName =
    stemFromContent && !isGenericIngestPlaceholder(stemFromContent)
      ? finalizeMaterialSectionLabel(stemFromContent)
      : resolveMaterialSectionLabel({
          outlineTitle: outline.title,
          payload,
          originalFileName: uploadLabel,
        });
  const materialSummary =
    typeof payload.description === "string" &&
    payload.description.trim() &&
    !isGenericIngestPlaceholder(payload.description)
      ? payload.description.trim()
      : payload.title?.trim() || storedFileName;

  // Insert study_materials first, then atomically flip job status to `complete`
  // in a single UPDATE that also sets material_id. Doing both in one operation
  // avoids a window where status=complete but material_id=null (which would
  // leave the polling client spinning forever).
  const materialInsert: Record<string, unknown> = {
    user_id: materialOwnerId,
    course_id: courseId,
    exam_group_id: examGroupId,
    file_name: storedFileName,
    summary: materialSummary,
    key_concepts: [] as string[],
    questions: [] as unknown[],
    course_payload: payload,
    sort_order: nextSortOrder,
  };
  if (localizedMaterial) {
    materialInsert.canonical_payload = localizedMaterial.canonical;
    materialInsert.base_locale = localizedMaterial.baseLocale;
    materialInsert.display_locale = localizedMaterial.displayLocale;
    materialInsert.content_source_key = localizedMaterial.contentSourceKey;
  }
  if (options?.ingestMedia) {
    materialInsert.ingest_media = options.ingestMedia;
  }
  if (options?.sourceIndex && options.sourceIndex.chunks.length > 0) {
    materialInsert.source_index = options.sourceIndex;
  }
  if (embedResult.figuresIndex) {
    materialInsert.figures_index = embedResult.figuresIndex;
  }
  if (effectiveManifest && effectiveManifest.assets.length > 0) {
    materialInsert.asset_manifest = effectiveManifest;
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

  if (
    insErr &&
    options?.sourceIndex &&
    isMissingDbColumnError(insErr, "source_index")
  ) {
    const { source_index: _s, ...withoutSourceIndex } = materialInsert;
    void _s;
    const retry = await admin
      .from("study_materials")
      .insert(withoutSourceIndex as never)
      .select("id")
      .single();
    row = retry.data;
    insErr = retry.error;
  }

  if (
    insErr &&
    assetManifest &&
    isMissingDbColumnError(insErr, "asset_manifest")
  ) {
    const { asset_manifest: _a, ...withoutAssetManifest } = materialInsert;
    void _a;
    const retry = await admin
      .from("study_materials")
      .insert(withoutAssetManifest as never)
      .select("id")
      .single();
    row = retry.data;
    insErr = retry.error;
  }

  if (
    insErr &&
    embedResult.figuresIndex &&
    isMissingDbColumnError(insErr, "figures_index")
  ) {
    const { figures_index: _f, ...withoutFiguresIndex } = materialInsert;
    void _f;
    const retry = await admin
      .from("study_materials")
      .insert(withoutFiguresIndex as never)
      .select("id")
      .single();
    row = retry.data;
    insErr = retry.error;
  }

  if (
    insErr &&
    options?.ingestMedia &&
    options?.sourceIndex &&
    isMissingDbColumnError(insErr, "ingest_media", "source_index")
  ) {
    const {
      ingest_media: _m,
      source_index: _s,
      ...minimalInsert
    } = materialInsert;
    void _m;
    void _s;
    const retry = await admin
      .from("study_materials")
      .insert(minimalInsert as never)
      .select("id")
      .single();
    row = retry.data;
    insErr = retry.error;
  }

  if (
    insErr &&
    localizedMaterial &&
    isMissingDbColumnError(
      insErr,
      "canonical_payload",
      "base_locale",
      "display_locale",
      "content_source_key"
    )
  ) {
    const {
      canonical_payload: _c,
      base_locale: _b,
      display_locale: _d,
      content_source_key: _k,
      ...withoutCanonical
    } = materialInsert;
    void _c;
    void _b;
    void _d;
    void _k;
    const retry = await admin
      .from("study_materials")
      .insert(withoutCanonical as never)
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

  await logActivity(
    {
      userId: materialOwnerId,
      type: "course_built",
      summary: payload.title || storedFileName,
      metadata: { courseId, materialId: row.id, jobId },
    },
    admin
  );

  try {
    await linkCourseAssetsToMaterial(admin, jobId, row.id);
  } catch (e) {
    console.error("[pdf-ingest] linkCourseAssetsToMaterial FAILED", jobId, e);
    throw e;
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
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, status, material_id, error_message, ingest_source_text, ingest_outline, ingest_modules, ingest_epoch, created_at, retain_storage, ingest_media, ingest_source_images, source_files"
    )
    .eq("id", jobId)
    .maybeSingle();

  const expandGenerationContext = job?.id
    ? await loadCourseGenerationContext(
        admin,
        job.id,
        typeof job.course_id === "string" ? job.course_id : null
      )
    : { studyContext: null, outputLanguage: DEFAULT_COURSE_OUTPUT_LANGUAGE };

  const sourceTextForLocale =
    typeof job?.ingest_source_text === "string" ? job.ingest_source_text : "";
  const { canonicalLocale: expandCanonicalLocale } =
    resolveCanonicalAndDisplayLocales(
      expandGenerationContext.outputLanguage,
      sourceTextForLocale
    );
  const generationLanguage = courseContentLocaleToOutputLanguage(
    expandCanonicalLocale
  );

  // STRUCTURE_PLANNING: per-module source text assembled from each module's
  // lessons' chunk ids. Separate defensive query so DBs without migration 045
  // still expand normally (missing-column error is swallowed).
  let moduleSources: string[] | null = null;
  let ingestPageArtifacts: IngestPageArtifacts = { tables: {}, figures: [] };
  let ingestAssetManifest: CourseAssetManifest | null = null;
  let sourceIndexForInject: SourceIndex | null = null;
  if (job?.id) {
    const { data: msRow } = await admin
      .from("pdf_ingest_jobs")
      .select("ingest_module_sources")
      .eq("id", job.id)
      .maybeSingle();
    const raw = (msRow as { ingest_module_sources?: unknown } | null | undefined)
      ?.ingest_module_sources;
    if (Array.isArray(raw)) {
      moduleSources = raw.map((x) => (typeof x === "string" ? x : ""));
    }
    ingestPageArtifacts = await loadIngestPageArtifacts(admin, job.id);
    ingestAssetManifest = await loadIngestAssetManifest(admin, job.id);
    sourceIndexForInject = await loadIngestSourceIndex(admin, job.id);
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

  const ingestPhaseRaw = (job as { ingest_phase?: unknown }).ingest_phase;
  if (
    ingestPhaseRaw === "enriching_sources" ||
    ingestPhaseRaw === "planning_outline" ||
    ingestPhaseRaw === "planning_preview"
  ) {
    return {
      kind: "failed",
      message: "Still preparing source material — try again in a moment.",
    };
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
  let storedModules: IndexedStoredModules;
  try {
    storedModules = parseStoredModulesIndexed(job.ingest_modules);
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
  const idx = contiguousPrefixLength(storedModules);
  const prefix = storedModules.slice(0, idx).filter(
    (m): m is CourseModule => m != null
  );

  const retainStorage = Boolean(
    (job as { retain_storage?: unknown }).retain_storage
  );
  const ingestMedia =
    (job as { ingest_media?: unknown }).ingest_media &&
    typeof (job as { ingest_media?: unknown }).ingest_media === "object"
      ? ((job as { ingest_media: Record<string, unknown> }).ingest_media)
      : null;

  const sourceImages = parseIngestSourceImages(
    (job as { ingest_source_images?: unknown }).ingest_source_images
  );

  if (prefix.length >= n) {
    const sourceIndex = await loadIngestSourceIndex(admin, jobId);
    const ingestAssetManifest = await loadIngestAssetManifest(admin, jobId);
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.course_id,
      job.exam_group_id,
      storagePaths,
      job.original_file_name,
      outline,
      prefix,
      {
        retainStorage,
        ingestMedia,
        sourceImages,
        sourceIndex,
        assetManifest: ingestAssetManifest,
        sourceText: sourceTextForLocale,
        outputLanguage: expandGenerationContext.outputLanguage,
      }
    );
    if (!fin) {
      return { kind: "failed", message: "Could not save study material." };
    }
    return { kind: "complete", materialId: fin.materialId };
  }

  await touchJobProgress(admin, jobId);

  if (await isStaleIngestEpoch(admin, jobId, expandEpoch)) {
    return {
      kind: "failed",
      message:
        "This build was restarted. Refresh the page if this tab still looks stuck.",
    };
  }

  // FIFO queue for module generation, same shape as the outline queue in
  // `runPdfIngestJob`. The cap is now generous (TPM is enforced globally by the
  // DB-backed Claude rate limiter, not by this per-user job count) and mostly
  // exists to keep finish order = upload order. Earliest `created_at` goes
  // first so tabs finish in upload order (matches the UI's numbered list).
  const moduleConcurrencyEnv =
    process.env.PDF_INGEST_MODULE_CONCURRENCY?.trim();
  const moduleConcurrencyParsed = moduleConcurrencyEnv
    ? Number.parseInt(moduleConcurrencyEnv, 10)
    : Number.NaN;
  const MODULE_CONCURRENCY = Number.isFinite(moduleConcurrencyParsed)
    ? Math.max(1, Math.min(40, moduleConcurrencyParsed))
    : 10;
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
  const expandBatchStartedAt = Date.now();
  console.info("[pdf-ingest] expand module batch", {
    jobId,
    batchCount,
    moduleIndices: batchIndices,
    remaining: n - idx,
    skipQuizBackfill: true,
  });
  const moduleHeartbeat = setInterval(() => {
    void touchJobProgress(admin, jobId);
  }, 22_000);

  // Persist each module at its outline index as soon as it resolves (even when
  // batch peers finish out of order) so the UI can tick 1/5, 2/5, … instead of
  // jumping 0→3 when a whole parallel batch lands. Resume still advances only
  // along the contiguous prefix from index 0.
  const resolvedModules = new Map<number, CourseModule>();
  let persistChain: Promise<void> = Promise.resolve();
  const previewFileName =
    typeof job.original_file_name === "string" && job.original_file_name.trim()
      ? job.original_file_name.trim()
      : "upload.pdf";

  const persistIndexedModules = async () => {
    const slots: IndexedStoredModules = Array.from({ length: n }, (_, i) => {
      if (i < storedModules.length && storedModules[i] != null) {
        return storedModules[i];
      }
      return resolvedModules.get(i) ?? null;
    });
    const enrichIndices: number[] = [];
    const toEnrich: CourseModule[] = [];
    for (let i = 0; i < slots.length; i++) {
      const m = slots[i];
      if (m == null) continue;
      enrichIndices.push(i);
      toEnrich.push(m);
    }
    if (toEnrich.length > 0) {
      try {
        const enriched = await enrichModulesWithPdfAssets({
          admin,
          jobId,
          modules: toEnrich,
          manifest: ingestAssetManifest,
          pageArtifacts: ingestPageArtifacts,
          fileName: previewFileName,
        });
        for (let j = 0; j < enrichIndices.length; j++) {
          slots[enrichIndices[j]!] = enriched[j]!;
        }
      } catch (e) {
        console.warn("[pdf-ingest] enrich modules for live preview", jobId, e);
      }
    }
    storedModules = slots;
    await admin
      .from("pdf_ingest_jobs")
      .update({
        ingest_modules: slots,
        stream_preview: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("ingest_epoch", expandEpoch);
  };

  try {
    await Promise.all(
      batchIndices.map((moduleIndex, offset) =>
        withAnthropicRateLimitRetries(
          jobId,
          batchCount === 1 ? "module" : `module-${moduleIndex + 1}`,
          async () => {
            const planned = moduleSources?.[moduleIndex];
            const materialForModule =
              typeof planned === "string" && planned.trim().length > 0
                ? planned
                : job.ingest_source_text;
            const modOutline = outline.modules[moduleIndex];
            let moduleGenOptions: ModuleGenerationOptions = {
              skipQuizBackfill: true,
            };
            if (
              ingestAssetManifest &&
              ingestAssetManifest.assets.length > 0 &&
              modOutline
            ) {
              const retrieved = await retrieveAssetsForModuleOutline({
                manifest: ingestAssetManifest,
                moduleTitle: modOutline.title,
                lessonTitles: modOutline.lesson_titles,
              });
              const prompt = formatAssetManifestForPrompt(retrieved);
              if (prompt.trim()) {
                moduleGenOptions = {
                  ...moduleGenOptions,
                  assetManifestPrompt: prompt,
                };
              }
            }
            return generateCourseModuleFromMaterial(
              materialForModule,
              outline,
              moduleIndex,
              offset === 0 ? createPdfStreamSink(admin, jobId) : undefined,
              expandGenerationContext.studyContext ?? undefined,
              generationLanguage,
              moduleGenOptions
            );
          },
          // 6 attempts × 90 s exp-backoff cap = ~126 s worst-case retry +
          // ~30 s generation = ~156 s. Comfortably under Vercel's 300 s
          // maxDuration so /expand always returns cleanly to the client
          // (which has its own retry loop via polling). 16 here meant the
          // function would get force-killed mid-retry, the client would
          // reconnect, and the same module would be re-attempted from zero
          // — the UI looked stuck at "Writing module N of M" for minutes.
          { maxAttempts: 6 }
        ).then((mod) => {
          const planned = moduleSources?.[moduleIndex];
          let injected = mod;
          const plan = sourceIndexForInject?.plan ?? null;
          const chunks = sourceIndexForInject?.chunks ?? [];
          const tableMap = new Map(Object.entries(ingestPageArtifacts.tables));
          if (plan && (tableMap.size > 0 || ingestPageArtifacts.figures.length > 0)) {
            const tables = collectPdfTablesForModule(
              moduleIndex,
              plan,
              chunks,
              tableMap
            );
            const figures = collectPdfFiguresForModule(
              moduleIndex,
              plan,
              chunks,
              ingestPageArtifacts.figures
            );
            injected = injectPdfArtifactsIntoModule(injected, tables, figures, {
              planModule: plan.modules[moduleIndex],
              chunks,
              pageTables: tableMap,
            });
          }
          if (typeof planned === "string" && planned.trim().length > 0) {
            const fromSource = extractPdfTableBlocksFromSource(planned);
            if (fromSource.length > 0) {
              injected = injectPdfArtifactsIntoModule(
                injected,
                fromSource,
                [],
                plan
                  ? {
                      planModule: plan.modules[moduleIndex],
                      chunks,
                      pageTables: tableMap,
                    }
                  : undefined
              );
            }
          }
          resolvedModules.set(moduleIndex, injected);
          // Serialize DB writes so concurrently-resolving modules don't race.
          persistChain = persistChain.then(persistIndexedModules);
          return persistChain;
        })
      )
    );
    await persistChain;
    console.info("[pdf-ingest] expand module batch done", {
      jobId,
      batchCount,
      elapsedMs: Date.now() - expandBatchStartedAt,
      estimatedQuizBackfillSavedMs: batchCount * 45_000,
    });
  } catch (e) {
    // Flush any contiguous modules that DID resolve before the failure, so a
    // retry resumes from there instead of rebuilding saved modules.
    await persistChain.catch(() => {});
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

  const contiguousEnd = contiguousPrefixLength(storedModules);
  const cappedNext = storedModules
    .slice(0, contiguousEnd)
    .filter((m): m is CourseModule => m != null);
  const { data: modRow, error: upErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      ingest_modules: storedModules.slice(0, n),
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
    const sourceIndex = await loadIngestSourceIndex(admin, jobId);
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.course_id,
      job.exam_group_id,
      storagePaths,
      job.original_file_name,
      outline,
      cappedNext,
      {
        retainStorage,
        ingestMedia,
        sourceImages,
        sourceIndex,
        sourceText: sourceTextForLocale,
        outputLanguage: expandGenerationContext.outputLanguage,
      }
    );
    if (!fin) {
      return { kind: "failed", message: "Could not save study material." };
    }
    return { kind: "complete", materialId: fin.materialId };
  }

  return {
    kind: "progress",
    modulesBuilt: countIngestModulesBuilt(storedModules),
    modulesTotal: n,
  };
}

/**
 * Server-side reaper: advance jobs that have stalled.
 *
 * In the chunked pipeline, module writing (phase 2) is normally driven by the
 * browser's `/expand` polling loop. If the user closes the tab — or a serverless
 * invocation is killed mid-flight — a job can sit in `writing_modules` (or never
 * leave `pending`) with no one to push it. Each running job heartbeats
 * `updated_at` every ~8–22 s, so a `running` row that hasn't updated in a while
 * has no live driver and is safe to re-kick. `runPdfIngestExpandOne` /
 * `runPdfIngestJob` both claim atomically, so re-kicking a job that *does* have a
 * live driver is a harmless no-op.
 *
 * Intended to be called on a schedule (Vercel Cron) and/or self-chained. Returns
 * how many jobs were kicked and how many remain active (for chaining decisions).
 */
/**
 * Re-run extraction for a job whose lambda died mid-`reading_pdf`/`transcribing`.
 * Atomically flips it back to `pending` (guarded by the epoch we observed so
 * only one reaper wins the race) and re-dispatches the full phase-1 worker.
 */
async function resumeStalledExtraction(
  admin: SupabaseClient,
  row: { id: string; ingest_epoch?: number | null }
): Promise<void> {
  const prevEpoch =
    typeof row.ingest_epoch === "number" && Number.isFinite(row.ingest_epoch)
      ? row.ingest_epoch
      : 0;
  const { data: claimed } = await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "pending",
      ingest_phase: null,
      ingest_epoch: prevEpoch + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "running")
    .eq("ingest_epoch", prevEpoch)
    .select("id")
    .maybeSingle();
  if (!claimed) return; // another reaper already grabbed it
  await runPdfIngestJob(row.id);
}

export async function reapStaleIngestJobs(options?: {
  maxJobs?: number;
  staleRunningMs?: number;
  stalePendingMs?: number;
}): Promise<{ kicked: number; remaining: number }> {
  const admin = createAdminClient();
  if (!admin) return { kicked: 0, remaining: 0 };

  // Piggyback audit-log retention on the cron-backed reaper (runs every minute).
  await pruneActivityEvents(admin);

  const maxJobs = options?.maxJobs ?? 16;
  const staleRunning = new Date(
    Date.now() - (options?.staleRunningMs ?? 75_000)
  ).toISOString();
  const stalePending = new Date(
    Date.now() - (options?.stalePendingMs ?? 25_000)
  ).toISOString();

  const [{ data: runningJobs }, { data: pendingJobs }] = await Promise.all([
    admin
      .from("pdf_ingest_jobs")
      .select("id, ingest_phase, ingest_epoch")
      .eq("status", "running")
      .lt("updated_at", staleRunning)
      .order("updated_at", { ascending: true })
      .limit(maxJobs),
    admin
      .from("pdf_ingest_jobs")
      .select("id")
      .eq("status", "pending")
      .lt("created_at", stalePending)
      .order("created_at", { ascending: true })
      .limit(maxJobs),
  ]);

  const tasks: Promise<unknown>[] = [];
  for (const j of pendingJobs ?? []) {
    tasks.push(
      runPdfIngestJob((j as { id: string }).id).catch((e) =>
        console.warn("[pdf-ingest] reaper pending kick failed", e)
      )
    );
  }
  for (const j of runningJobs ?? []) {
    const row = j as {
      id: string;
      ingest_phase?: string | null;
      ingest_epoch?: number | null;
    };
    const phase = row.ingest_phase ?? null;
    // The extraction phases (`reading_pdf` / `transcribing`) can't be resumed
    // by `expand` — if the lambda was killed mid-extraction the job would sit
    // wedged on "step 1/2" forever. Reset it to `pending` (bumping the epoch so
    // any zombie writes from the dead run are ignored) and re-run extraction.
    // The 8s heartbeat means a live extraction is never stale, so this only
    // fires for genuinely dead runs. `reviewing_transcript` stays paused.
    if (phase === "reading_pdf" || phase === "transcribing") {
      tasks.push(
        resumeStalledExtraction(admin, row).catch((e) =>
          console.warn("[pdf-ingest] reaper extraction resume failed", e)
        )
      );
      continue;
    }
    // Safe for any other phase: expand returns "not ready" cheaply if the job
    // isn't in writing_modules yet, and advances one batch when it is.
    tasks.push(
      runPdfIngestExpandOne(row.id).catch((e) =>
        console.warn("[pdf-ingest] reaper expand kick failed", e)
      )
    );
  }
  await Promise.allSettled(tasks);

  const { count: remaining } = await admin
    .from("pdf_ingest_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "running"]);

  return { kicked: tasks.length, remaining: remaining ?? 0 };
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

  const generationContext = claimed?.id
    ? await loadCourseGenerationContext(
        admin,
        claimed.id,
        typeof claimed.course_id === "string" ? claimed.course_id : null
      )
    : { studyContext: null, outputLanguage: DEFAULT_COURSE_OUTPUT_LANGUAGE };

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
    chunks: IngestChunk[];
    sourceImages: IngestSourceImageRecord[];
    primaryPdfBuffer: Buffer | null;
    primaryPdfFileName: string | null;
  };

  try {
    const extracted = await extractContentForIngestJob({
      admin,
      jobId,
      userId: claimed.user_id,
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
      chunks: extracted.chunks ?? [],
      sourceImages: extracted.sourceImages,
      primaryPdfBuffer: extracted.primaryPdfBuffer,
      primaryPdfFileName: extracted.primaryPdfFileName,
    };

    await admin
      .from("pdf_ingest_jobs")
      .update({
        retain_storage: extracted.retainStorage,
        ingest_media: extracted.ingestMedia,
        ingest_source_images: extracted.sourceImages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .then(({ error }) => {
        if (
          error &&
          isMissingDbColumnError(error, "ingest_source_images")
        ) {
          return admin
            .from("pdf_ingest_jobs")
            .update({
              retain_storage: extracted.retainStorage,
              ingest_media: extracted.ingestMedia,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
        return { error };
      }, () => {});

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

  const contentSourceKey = computeContentSourceKey(
    sourceTextForOutline,
    claimed.original_file_name
  );
  const sibling = await findSiblingCanonicalMaterial(
    admin,
    claimed.course_id,
    contentSourceKey
  );
  const isPdfUpload = /\.pdf$/i.test(claimed.original_file_name ?? "");
  // PDF decks need per-job vision tables/figures — sibling canonical lacks them.
  if (sibling && !isPdfUpload) {
    try {
      const localized = await displayPayloadFromExistingCanonical(
        sibling.canonical_payload,
        sibling.base_locale,
        generationContext.outputLanguage,
        sourceTextForOutline,
        claimed.original_file_name
      );
      const outline = coursePayloadToOutline(localized.canonical);
      const finished = await finalizePdfIngest(
        admin,
        jobId,
        claimed.course_id,
        claimed.exam_group_id,
        cleanupPaths,
        claimed.original_file_name,
        outline,
        localized.canonical.modules,
        {
          localized,
          retainStorage: previewResult.retainStorage,
          ingestMedia: previewResult.ingestMedia,
        }
      );
      if (finished) {
        console.info("[pdf-ingest] reused sibling canonical", {
          jobId,
          siblingMaterialId: sibling.id,
          displayLocale: localized.displayLocale,
        });
        return;
      }
    } catch (e) {
      console.warn(
        "[pdf-ingest] sibling canonical reuse failed; running full build",
        jobId,
        e
      );
    }
  }

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
    courseStudyContext: generationContext.studyContext,
    outputLanguage: generationContext.outputLanguage,
    chunks: previewResult.chunks,
    sourceImages: previewResult.sourceImages,
    sourceFiles,
    primaryStoragePath: storagePath,
    primaryFileName: claimed.original_file_name,
    primaryPdfBuffer: previewResult.primaryPdfBuffer,
    knownPageCount: previewResult.numpages,
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

  const generationContext = await loadCourseGenerationContext(
    admin,
    jobId,
    typeof job.course_id === "string" ? job.course_id : null
  );

  await runPdfIngestOutlinePhase(admin, {
    jobId,
    claimed: job,
    claimedEpoch,
    cleanupPaths,
    sourceTextForOutline: transcript,
    courseStudyContext: generationContext.studyContext,
    outputLanguage: generationContext.outputLanguage,
    // Transcript-resume has no per-file chunks here; use the legacy outline path.
    chunks: [],
    driveModules: options?.driveModules,
    t0: Date.now(),
  });
}

function isPdfPageRenderEnabled(): boolean {
  // Figure / page-render extraction disabled — whiteboard is text + tables only.
  return false;
  const raw = process.env.PDF_INGEST_PAGE_RENDER?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return true;
}

function collectUploadFileNames(input: {
  primaryFileName?: string | null;
  sourceFiles?: IngestSourceFileRef[] | null;
  chunks?: IngestChunk[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name?: string | null) => {
    const t = name?.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  add(input.primaryFileName);
  for (const chunk of input.chunks ?? []) add(chunk.sourceFileName);
  for (const file of input.sourceFiles ?? []) add(file.originalFileName);
  return out;
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
    outputLanguage: CourseOutputLanguage;
    chunks: IngestChunk[];
    sourceImages?: IngestSourceImageRecord[];
    sourceFiles?: IngestSourceFileRef[] | null;
    primaryStoragePath?: string;
    primaryFileName?: string | null;
    primaryPdfBuffer?: Buffer | null;
    knownPageCount?: number;
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
    outputLanguage: uploadOutputLanguage,
    chunks,
    sourceImages: sourceImagesInput = [],
    sourceFiles = null,
    primaryStoragePath = "",
    primaryFileName = null,
    primaryPdfBuffer = null,
    knownPageCount = 0,
    driveModules,
    t0,
  } = input;

  const { canonicalLocale } = resolveCanonicalAndDisplayLocales(
    uploadOutputLanguage,
    sourceTextForOutline
  );
  const generationLanguage =
    courseContentLocaleToOutputLanguage(canonicalLocale);

  // Structure planning uses per-chunk source text on the job; skip the slow
  // multi-call digest for long PDFs when chunks already carry full coverage.
  const storedMaterial =
    chunks.length > 0
      ? materialTextForPdfIngest(sourceTextForOutline)
      : sourceTextForOutline.length > 24_000
        ? await buildMaterialDigestFromFullPdfText(sourceTextForOutline, {
            studyContext: courseStudyContext ?? undefined,
          })
        : materialTextForPdfIngest(sourceTextForOutline);

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
    ? Math.max(1, Math.min(40, concurrencyParsed))
    : 10;
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

  // Content-driven structure planning whenever we have chunks — maps each
  // lesson to source_chunk_ids for per-lesson attribution at finalize.
  const useStructurePlanning = chunks.length > 0;

  let outline: CourseOutlinePayload;
  let planModuleSources: string[] | null = null;
  let planJson: unknown = null;
  let sourceImages = sourceImagesInput;
  let chunksForGeneration = chunks;
  let pageArtifactsForJob: IngestPageArtifacts = { tables: {}, figures: [] };
  let assetManifestForJob: CourseAssetManifest | null = null;
  try {
    if (useStructurePlanning) {
      const plan = await withAnthropicRateLimitRetries(
        jobId,
        "structure-plan",
        () =>
          planCourseStructureFromChunks(
            summarizeChunksForPlanner(chunks),
            streamSink,
            courseStudyContext ?? undefined,
            generationLanguage
          ),
        { maxAttempts: 14 }
      );
      outline = structurePlanToOutline(plan, {
        uploadFileNames: collectUploadFileNames({
          primaryFileName,
          sourceFiles,
          chunks,
        }),
      });
      planJson = plan;
      console.info("[pdf-ingest] structure plan ok", {
        jobId,
        modules: outline.modules.length,
        chunks: chunks.length,
      });

      // Surface the outline immediately so the build UI can show module
      // titles while page renders + table vision run (often 1–3 min on
      // large pharmacology PDFs).
      await admin
        .from("pdf_ingest_jobs")
        .update({
          ingest_outline: outline,
          ingest_plan: planJson,
          ingest_phase: "enriching_sources",
          stream_preview: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("ingest_epoch", claimedEpoch);

      if (isPdfPageRenderEnabled() && (primaryStoragePath || primaryPdfBuffer)) {
        console.info("[pdf-ingest] visual enrich starting", {
          jobId,
          hasStoragePath: Boolean(primaryStoragePath),
          hasPdfBuffer: Boolean(primaryPdfBuffer),
          bufferBytes: primaryPdfBuffer?.length ?? 0,
        });
        try {
          const supplemented = await supplementPdfPageFigures({
            admin,
            userId: claimed.user_id,
            jobId,
            chunks: persistIngestChunks(chunks),
            plan,
            existingImages: sourceImages,
            sourceFiles,
            primaryStoragePath,
            primaryFileName,
            primaryPdfBuffer,
            knownPageCount: knownPageCount > 0 ? knownPageCount : undefined,
          });
          sourceImages = filterCroppedFiguresOnly(supplemented.images);
          pageArtifactsForJob = supplemented.pageArtifacts;
          const pageTables = pageTableExtractionsToMap(
            supplemented.pageTableExtractions
          );
          const pageFigures = pageArtifactsForJob.figures;
          if (pageTables.size > 0) {
            chunksForGeneration = enrichChunksWithPageTables(chunks, pageTables);
          }
          if (pageFigures.length > 0) {
            chunksForGeneration = enrichChunksWithPageFigures(
              chunksForGeneration,
              pageFigures
            );
          }
          if (pageTables.size > 0 || pageFigures.length > 0) {
            console.info("[pdf-ingest] enriched chunks with page artifacts", {
              jobId,
              tablePages: pageTables.size,
              figurePages: pageFigures.length,
            });
          }
          try {
            assetManifestForJob = await buildCourseAssetManifest(
              pageArtifactsForJob
            );
            if (assetManifestForJob.assets.length > 0) {
              console.info("[pdf-ingest] asset manifest", {
                jobId,
                assets: assetManifestForJob.assets.length,
              });
            }
          } catch (e) {
            console.warn("[pdf-ingest] buildCourseAssetManifest", jobId, e);
          }
        } catch (e) {
          console.error("[pdf-ingest] supplementPdfPageFigures FAILED", jobId, e);
          await failJobUnlessStale(
            admin,
            jobId,
            cleanupPaths,
            e instanceof Error ? e.message : "PDF visual extraction failed.",
            claimedEpoch
          );
          return;
        }
      } else if (
        isPdfTableVisionEnabled() &&
        primaryPdfBuffer &&
        primaryPdfBuffer.length > 0
      ) {
        try {
          const extractions = await supplementPdfTablesOnly({
            pdfBuffer: primaryPdfBuffer,
            sourceFileName: primaryFileName?.trim() || "upload.pdf",
            chunks,
            jobId,
          });
          const pageTables = pageTableExtractionsToMap(extractions);
          if (pageTables.size > 0) {
            pageArtifactsForJob = {
              tables: Object.fromEntries(pageTables),
              figures: [],
            };
            chunksForGeneration = enrichChunksWithPageTables(chunks, pageTables);
            console.info("[pdf-ingest] table-only vision enrich", {
              jobId,
              tablePages: pageTables.size,
            });
          }
        } catch (e) {
          console.warn("[pdf-ingest] supplementPdfTablesOnly", jobId, e);
        }
      } else {
        console.warn("[pdf-ingest] visual enrich skipped at outline", {
          jobId,
          pageRenderEnabled: isPdfPageRenderEnabled(),
          tableVisionEnabled: isPdfTableVisionEnabled(),
          hasStoragePath: Boolean(primaryStoragePath),
          hasPdfBuffer: Boolean(primaryPdfBuffer),
        });
      }

      planModuleSources = assembleModuleSourcesFromPlan(
        plan,
        chunksForGeneration
      );
    } else {
      outline = await withAnthropicRateLimitRetries(
        jobId,
        "outline",
        () =>
          generateCourseOutlineFromMaterial(
            sourceTextForOutline,
            streamSink,
            courseStudyContext ?? undefined,
            generationLanguage,
            {
              uploadFileNames: collectUploadFileNames({
                primaryFileName,
                sourceFiles,
                chunks,
              }),
            }
          ),
        { maxAttempts: 14 }
      );
    }
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

  const outlineUpdate: Record<string, unknown> = {
    ingest_source_text: storedMaterial,
    ingest_outline: outline,
    ingest_modules: [],
    ingest_preview_outline: null,
    stream_preview: null,
    ingest_phase: "writing_modules",
    ingest_chunks: persistIngestChunks(chunksForGeneration),
    updated_at: new Date().toISOString(),
  };
  if (useStructurePlanning) {
    outlineUpdate.ingest_plan = planJson;
    outlineUpdate.ingest_module_sources = planModuleSources;
  }
  if (sourceImages.length > 0) {
    outlineUpdate.ingest_source_images = sourceImages;
  }
  if (
    Object.keys(pageArtifactsForJob.tables).length > 0 ||
    pageArtifactsForJob.figures.length > 0
  ) {
    outlineUpdate.ingest_page_tables = pageArtifactsForJob;
  }
  if (assetManifestForJob && assetManifestForJob.assets.length > 0) {
    outlineUpdate.ingest_asset_manifest = assetManifestForJob;
  }

  let { data: outlineRow, error: outlineErr } = await admin
    .from("pdf_ingest_jobs")
    .update(outlineUpdate)
    .eq("id", jobId)
    .eq("ingest_epoch", claimedEpoch)
    .select("id")
    .maybeSingle();

  // Graceful fallback: structure-planning columns not migrated yet (045).
  if (
    outlineErr &&
    isMissingDbColumnError(
      outlineErr,
      "ingest_plan",
      "ingest_module_sources",
      "ingest_chunks",
      "ingest_page_tables",
      "ingest_asset_manifest"
    )
  ) {
    const retry = await admin
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
    outlineRow = retry.data;
    outlineErr = retry.error;
  }

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
