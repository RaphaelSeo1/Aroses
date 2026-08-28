import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { buildLivePreviewCourse, tryOutlinePreviewFromStreamTail } from "@/lib/pdf-ingest-preview";
import { enrichModulesWithPdfAssets } from "@/lib/pdf-ingest/enrich-modules-with-assets";
import {
  countIngestModulesBuilt,
  runPdfIngestExpandOne,
  runPdfIngestJob,
} from "@/lib/pdf-ingest-runner";
import { parseCourseAssetManifest } from "@/lib/study-ingest/course-assets";
import { parseIngestPageArtifacts } from "@/lib/study-ingest/inject-pdf-tables-into-module";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { report } from "@/lib/report-error";
import type { CoursePayload } from "@/types/course";

export const runtime = "nodejs";
/** Align with other PDF-ingest routes on Vercel Pro (Hobby: lower cap may be required). */
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/**
 * If the worker dies without updating the row, the UI would poll forever. We synthesize `failed`
 * when `updated_at` is too old. Thresholds must exceed:
 * - pending: cold start / `after()` queue on Vercel
 * - running: PDF work + **slow outline** (minutes) + each **expand** (up to `maxDuration` per request)
 *
 * Default **express** jobs should finish in minutes; stale budget still allows slow networks.
 * Use longer client/server budgets when `COURSE_BUILD_PROFILE=full` or similar.
 */
const STALE_PENDING_MS = 15 * 60 * 1000 + 30_000;
const STALE_RUNNING_MS = 18 * 60 * 1000 + 30_000;

export async function GET(_request: Request, ctx: Params) {
  const { jobId } = await ctx.params;
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const JOB_SELECT_BASE =
    "status, material_id, error_message, updated_at, created_at, ingest_outline, ingest_preview_outline, ingest_modules, original_file_name, stream_preview, ingest_phase, ingest_epoch";

  let { data: row, error } = await supabase
    .from("pdf_ingest_jobs")
    .select(`${JOB_SELECT_BASE}, ingest_transcript, source_format`)
    .eq("id", jobId)
    .maybeSingle();

  if (error && isMissingDbColumnError(error, "ingest_transcript", "source_format")) {
    ({ data: row, error } = await supabase
      .from("pdf_ingest_jobs")
      .select(JOB_SELECT_BASE)
      .eq("id", jobId)
      .maybeSingle());
  }

  if (error || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const updatedAt =
    typeof row.updated_at === "string" ? Date.parse(row.updated_at) : NaN;
  const staleBudgetMs =
    row.status === "pending" ? STALE_PENDING_MS : STALE_RUNNING_MS;
  const stale =
    (row.status === "pending" || row.status === "running") &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > staleBudgetMs;

  if (stale) {
    const staleName =
      typeof row.original_file_name === "string" && row.original_file_name.trim()
        ? row.original_file_name.trim()
        : undefined;
    const staleMessage =
      "This build stopped making progress for a long time (the server may have hit a time limit or lost the connection). Try uploading the PDF again on a stable network. Hard-refresh the page first so your browser runs the latest upload code. Confirm migrations 020–028 are applied in Supabase and the service role key is set on the host.";

    // Persist the failure instead of only synthesizing it in the response.
    // Previously the UI said "failed" while the DB row stayed running, so the
    // cron reaper could keep burning tokens on a build the user already gave
    // up on. Conditional update (status + stale updated_at + epoch bump) so a
    // worker that revived in the meantime is never clobbered.
    const admin = createAdminClient();
    if (admin) {
      const prevEpoch =
        typeof (row as { ingest_epoch?: unknown }).ingest_epoch === "number"
          ? (row as { ingest_epoch: number }).ingest_epoch
          : 0;
      const { data: markedFailed } = await admin
        .from("pdf_ingest_jobs")
        .update({
          status: "failed",
          error_message: staleMessage,
          ingest_phase: null,
          ingest_epoch: prevEpoch + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .in("status", ["pending", "running"])
        .lt("updated_at", new Date(Date.now() - staleBudgetMs).toISOString())
        .select("id")
        .maybeSingle();
      if (markedFailed) {
        void report(
          "pdf-ingest.stale_job_failed",
          `job exceeded ${Math.round(staleBudgetMs / 60_000)}min stale budget in status "${row.status}"`,
          { jobId, detail: { status: row.status, fileName: staleName } }
        );
      }
    }

    return NextResponse.json({
      status: "failed",
      materialId: undefined,
      error: staleMessage,
      outlineReady: false,
      ingestPhase: null,
      modulesBuilt: 0,
      modulesTotal: 0,
      createdAt:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at.trim()
          : undefined,
      originalFileName: staleName,
      streamPreview: null,
      previewCourse: null,
    });
  }

  // Phase-1 stall reset: only while **reading the PDF** (`ingest_outline` still null).
  // Never during `planning_outline` — outline JSON is not persisted until the model
  // finishes, but `stream_preview` + heartbeats keep `updated_at` fresh; resetting
  // here caused stuck "planning outline" and lost work.
  //
  // **On by default at 15s.** When many PDFs are uploaded in parallel Vercel can
  // silently kill some `after()` workers; without this the job sits in
  // `reading_pdf` forever until the user clicks "Restart this PDF". The runner
  // heartbeats every 8 s during extraction, so 15 s is comfortably above noise
  // while still catching dead workers fast. Override with
  // `PDF_INGEST_STALL_PHASE1_MS` (ms), or set `0` to disable.
  const MIN_STALL_MS = 10 * 1000;
  const MAX_STALL_MS = 45 * 60 * 1000;
  const DEFAULT_STALL_PHASE1_MS = 15 * 1000;
  const stallPhase1Env = process.env.PDF_INGEST_STALL_PHASE1_MS?.trim();
  const stallPhase1Parsed = stallPhase1Env
    ? Number.parseInt(stallPhase1Env, 10)
    : Number.NaN;
  const STALL_PHASE1_MS =
    stallPhase1Env === "0" || stallPhase1Parsed === 0
      ? null
      : Number.isFinite(stallPhase1Parsed) &&
          stallPhase1Parsed >= MIN_STALL_MS &&
          stallPhase1Parsed <= MAX_STALL_MS
        ? stallPhase1Parsed
        : DEFAULT_STALL_PHASE1_MS;

  // **Pending pickup**: if a job has been `status=pending` for more than a few
  // seconds the original `after()` worker from `POST /api/process-pdf` never
  // started (Vercel dropped it, cold-start backlog, etc.). Re-kick it here so
  // the user does not have to click Restart. Override via
  // `PDF_INGEST_PENDING_KICK_MS` (ms), `0` to disable.
  const PENDING_MIN_MS = 2 * 1000;
  const PENDING_MAX_MS = 5 * 60 * 1000;
  const DEFAULT_PENDING_KICK_MS = 4 * 1000;
  const pendingKickEnv = process.env.PDF_INGEST_PENDING_KICK_MS?.trim();
  const pendingKickParsed = pendingKickEnv
    ? Number.parseInt(pendingKickEnv, 10)
    : Number.NaN;
  const PENDING_KICK_MS =
    pendingKickEnv === "0" || pendingKickParsed === 0
      ? null
      : Number.isFinite(pendingKickParsed) &&
          pendingKickParsed >= PENDING_MIN_MS &&
          pendingKickParsed <= PENDING_MAX_MS
        ? pendingKickParsed
        : DEFAULT_PENDING_KICK_MS;

  const createdAtMs =
    typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
  const pendingForMs =
    Number.isFinite(createdAtMs) && row.status === "pending"
      ? Date.now() - createdAtMs
      : 0;
  if (
    PENDING_KICK_MS != null &&
    row.status === "pending" &&
    pendingForMs >= PENDING_KICK_MS
  ) {
    // Atomic claim inside `runPdfIngestJob` makes duplicate kicks safe — only
    // one worker can flip status from `pending` to `running`. driveModules so
    // the re-kicked build also finishes without the tab staying open.
    after(() => {
      void runPdfIngestJob(jobId, { driveModules: true }).catch((e) =>
        console.error("[jobs/get] kick pending job", jobId, e)
      );
    });
  }

  const ingestPhaseRawEarly = (row as { ingest_phase?: unknown }).ingest_phase;
  // Auto-recovery now also covers `planning_outline` when the outline has not
  // been saved yet. A dead worker mid-stream looks identical to a dead worker
  // mid-extract from the row's perspective — `ingest_outline` is null and
  // `updated_at` stops advancing once the 8 s heartbeat interval dies with the
  // function. Including this phase makes the auto-restart cover the same cases
  // the manual "Restart this PDF" button does.
  const stallAppliesToThisPhase =
    ingestPhaseRawEarly === "reading_pdf" ||
    ingestPhaseRawEarly === "reading_full_pdf" ||
    ingestPhaseRawEarly === "planning_outline" ||
    ingestPhaseRawEarly === "transcribing" ||
    ingestPhaseRawEarly === null ||
    ingestPhaseRawEarly === undefined ||
    ingestPhaseRawEarly === "";

  // Break infinite restart loops. If we have already reset this job many times
  // and it keeps dying, the underlying problem (tier exhaustion, malformed
  // PDF, etc.) is not something another restart can solve — surface a real
  // failure instead of looping forever. Each auto-recovery bumps the epoch;
  // manual restarts also bump it, which is fine — after enough thrashing the
  // user should see an actionable error.
  const currentEpoch =
    typeof (row as { ingest_epoch?: unknown }).ingest_epoch === "number"
      ? (row as { ingest_epoch: number }).ingest_epoch
      : 0;
  const MAX_AUTO_RECOVERIES = 6;

  const isStuckPhase1 =
    STALL_PHASE1_MS != null &&
    stallAppliesToThisPhase &&
    row.status === "running" &&
    (row as { ingest_outline?: unknown }).ingest_outline == null &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > STALL_PHASE1_MS &&
    currentEpoch < MAX_AUTO_RECOVERIES;

  if (isStuckPhase1) {
    const admin = createAdminClient();
    if (admin) {
      const prevEpoch =
        typeof (row as { ingest_epoch?: unknown }).ingest_epoch === "number"
          ? (row as { ingest_epoch: number }).ingest_epoch
          : 0;
      const stallCutoff = new Date(Date.now() - STALL_PHASE1_MS).toISOString();
      const { data: reset } = await admin
        .from("pdf_ingest_jobs")
        .update({
          status: "pending",
          ingest_phase: null,
          stream_preview: null,
          ingest_preview_outline: null,
          ingest_epoch: prevEpoch + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "running")
        .is("ingest_outline", null)
        .lt("updated_at", stallCutoff)
        .select("id")
        .maybeSingle();

      if (reset) {
        console.warn("[jobs/get] auto-recovered stalled phase-1 job", jobId);
        // Server-side kick so the new worker fires even if the client is
        // momentarily not polling (closed tab, throttled background tab).
        // The atomic claim inside `runPdfIngestJob` makes a duplicate kick a
        // no-op if the client also fires `/expand` on the next poll.
        after(() => {
          void runPdfIngestJob(jobId, { driveModules: true }).catch((e) =>
            console.error("[jobs/get] kick after auto-recovery", jobId, e)
          );
        });
        return NextResponse.json({
          status: "pending",
          outlineReady: false,
          modulesBuilt: 0,
          modulesTotal: 0,
          ingestPhase: null,
          streamPreview: null,
          previewCourse: null,
          createdAt:
            typeof row.created_at === "string" ? row.created_at : undefined,
          originalFileName:
            typeof row.original_file_name === "string"
              ? row.original_file_name
              : undefined,
        });
      }
    }
  }

  // Soft stall-kick for the writing_modules phase. Module heartbeats fire
  // every 22 s during a live module call (plus queue heartbeats every 3.5 s
  // when waiting), so 60 s of no updates reliably means the /expand worker
  // died (Vercel maxDuration, OOM, or 504 mid-flight). Unlike phase-1 we do
  // NOT reset the row — keep status=running, ingest_outline, and the
  // ingest_modules prefix intact, and just fire a fresh /expand-style
  // worker. runPdfIngestExpandOne is idempotent: it reads modules.length and
  // continues from there. This unsticks UI like "Writing module 3 of 5" that
  // sits frozen because the prior fetch is hung.
  const MODULE_STALL_MS = 60_000;
  const phaseForModuleCheck = (row as { ingest_phase?: unknown }).ingest_phase;
  const outlineForModuleCheck = (row as { ingest_outline?: unknown })
    .ingest_outline;
  const modulesBuiltForCheck = countIngestModulesBuilt(row.ingest_modules);
  const outlineModuleCount =
    outlineForModuleCheck &&
    typeof outlineForModuleCheck === "object" &&
    Array.isArray((outlineForModuleCheck as { modules?: unknown[] }).modules)
      ? (outlineForModuleCheck as { modules: unknown[] }).modules.length
      : 0;
  const isStuckWritingModules =
    phaseForModuleCheck === "writing_modules" &&
    row.status === "running" &&
    outlineModuleCount > 0 &&
    modulesBuiltForCheck < outlineModuleCount &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > MODULE_STALL_MS &&
    currentEpoch < MAX_AUTO_RECOVERIES;

  // Finalize-stall recovery: every module is built but the job is still
  // `running` because a prior finalize attempt was killed (function timeout,
  // 504, or a closed tab) before it could insert the material + flip status.
  // A healthy finalize heartbeats every 15s, so a longer gap means the worker
  // is dead — re-kick the idempotent expand which will run finalize again.
  const FINALIZE_STALL_MS = 90_000;
  const isStuckFinalizing =
    phaseForModuleCheck === "writing_modules" &&
    row.status === "running" &&
    outlineModuleCount > 0 &&
    modulesBuiltForCheck >= outlineModuleCount &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > FINALIZE_STALL_MS &&
    currentEpoch < MAX_AUTO_RECOVERIES;

  if (isStuckWritingModules || isStuckFinalizing) {
    console.warn(
      isStuckFinalizing
        ? "[jobs/get] kicking stalled finalize job"
        : "[jobs/get] kicking stalled writing_modules job",
      jobId
    );
    after(() => {
      void runPdfIngestExpandOne(jobId).catch((e) =>
        console.error("[jobs/get] kick after module stall", jobId, e)
      );
    });
  }

  const outline = row.ingest_outline as { modules?: unknown[] } | null;
  const previewOutlineRaw = (row as { ingest_preview_outline?: unknown })
    .ingest_preview_outline;
  const modulesArr = Array.isArray(row.ingest_modules)
    ? (row.ingest_modules as unknown[])
    : [];
  const outlineReady =
    row.status === "running" &&
    outline != null &&
    typeof outline === "object" &&
    Array.isArray(outline.modules) &&
    outline.modules.length > 0;
  const modulesTotal =
    outlineReady && Array.isArray(outline.modules) ? outline.modules.length : 0;
  const modulesBuilt =
    outlineReady && row.status === "running"
      ? countIngestModulesBuilt(row.ingest_modules)
      : row.status === "complete"
        ? modulesTotal
        : 0;

  const createdAt =
    typeof row.created_at === "string" && row.created_at.trim()
      ? row.created_at.trim()
      : undefined;

  const originalFileName =
    typeof row.original_file_name === "string" && row.original_file_name.trim()
      ? row.original_file_name.trim()
      : undefined;

  const streamPreview =
    typeof row.stream_preview === "string" ? row.stream_preview : null;

  const ingestPhaseRaw = (row as { ingest_phase?: unknown }).ingest_phase;
  const ingestPhase =
    ingestPhaseRaw === "reading_pdf" ||
    ingestPhaseRaw === "reading_full_pdf" ||
    ingestPhaseRaw === "digesting_full_pdf" ||
    ingestPhaseRaw === "planning_preview" ||
    ingestPhaseRaw === "planning_outline" ||
    ingestPhaseRaw === "enriching_sources" ||
    ingestPhaseRaw === "writing_modules" ||
    ingestPhaseRaw === "reviewing_transcript" ||
    ingestPhaseRaw === "transcribing"
      ? ingestPhaseRaw
      : null;

  const ingestTranscript =
    typeof (row as { ingest_transcript?: unknown }).ingest_transcript === "string"
      ? (row as { ingest_transcript: string }).ingest_transcript
      : undefined;

  let previewCourse: CoursePayload | null = null;
  if (
    (outlineReady || row.status === "complete") &&
    outline != null &&
    typeof outline === "object"
  ) {
    previewCourse = buildLivePreviewCourse(outline, modulesArr);
    if (
      previewCourse &&
      row.status === "running" &&
      modulesArr.length > 0
    ) {
      const admin = createAdminClient();
      if (admin) {
        try {
          const { data: assetRow } = await admin
            .from("pdf_ingest_jobs")
            .select("ingest_page_tables, ingest_asset_manifest")
            .eq("id", jobId)
            .maybeSingle();
          const pageArtifacts = parseIngestPageArtifacts(
            (assetRow as { ingest_page_tables?: unknown } | null)
              ?.ingest_page_tables
          );
          const manifest = parseCourseAssetManifest(
            (assetRow as { ingest_asset_manifest?: unknown } | null)
              ?.ingest_asset_manifest
          );
          const fileName =
            typeof row.original_file_name === "string" &&
            row.original_file_name.trim()
              ? row.original_file_name.trim()
              : "upload.pdf";
          const enriched = await enrichModulesWithPdfAssets({
            admin,
            jobId,
            modules: previewCourse.modules,
            manifest,
            pageArtifacts,
            fileName,
          });
          previewCourse = { ...previewCourse, modules: enriched };
        } catch (e) {
          console.warn("[jobs/get] preview asset enrich", jobId, e);
        }
      }
    }
  } else if (
    row.status === "running" &&
    previewOutlineRaw != null &&
    typeof previewOutlineRaw === "object"
  ) {
    previewCourse = buildLivePreviewCourse(previewOutlineRaw, []);
  } else if (
    row.status === "running" &&
    (ingestPhase === "planning_outline" || ingestPhase === "planning_preview") &&
    streamPreview &&
    streamPreview.length >= 200
  ) {
    previewCourse = tryOutlinePreviewFromStreamTail(streamPreview);
  }

  return NextResponse.json({
    status: row.status,
    materialId: row.material_id ?? undefined,
    error:
      typeof row.error_message === "string" && row.error_message.trim()
        ? row.error_message.trim()
        : undefined,
    outlineReady,
    modulesBuilt,
    modulesTotal,
    createdAt,
    originalFileName,
    streamPreview,
    ingestPhase,
    ingestTranscript:
      ingestPhase === "reviewing_transcript" ? ingestTranscript : undefined,
    previewCourse,
  });
}
