import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildLivePreviewCourse, tryOutlinePreviewFromStreamTail } from "@/lib/pdf-ingest-preview";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const { data: row, error } = await supabase
    .from("pdf_ingest_jobs")
    .select(
      "status, material_id, error_message, updated_at, created_at, ingest_outline, ingest_preview_outline, ingest_modules, original_file_name, stream_preview, ingest_phase, ingest_epoch"
    )
    .eq("id", jobId)
    .maybeSingle();

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
    return NextResponse.json({
      status: "failed",
      materialId: undefined,
      error:
        "This build stopped making progress for a long time (the server may have hit a time limit or lost the connection). Try uploading the PDF again on a stable network. Hard-refresh the page first so your browser runs the latest upload code. Confirm migrations 020–028 are applied in Supabase and the service role key is set on the host.",
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
  // **Off by default.** Set `PDF_INGEST_STALL_PHASE1_MS` to milliseconds (60s–45m),
  // e.g. `60000` for 1 minute, to re-enable auto-reset during reading only.
  // `0` disables even when env is set.
  const MIN_STALL_MS = 60 * 1000;
  const MAX_STALL_MS = 45 * 60 * 1000;
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
        : null;

  const ingestPhaseRawEarly = (row as { ingest_phase?: unknown }).ingest_phase;
  const stallAppliesToThisPhase =
    ingestPhaseRawEarly === "reading_pdf" ||
    ingestPhaseRawEarly === "reading_full_pdf" ||
    ingestPhaseRawEarly === null ||
    ingestPhaseRawEarly === undefined ||
    ingestPhaseRawEarly === "";

  const isStuckPhase1 =
    STALL_PHASE1_MS != null &&
    stallAppliesToThisPhase &&
    row.status === "running" &&
    (row as { ingest_outline?: unknown }).ingest_outline == null &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > STALL_PHASE1_MS;

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
        // Don't use after() here — it shares the invocation budget and can be
        // killed before phase 1 finishes. The client will see `pending` and
        // fire its own fire-and-forget POST /expand, which now runs phase 1
        // inline (awaited) for the full 300 s serverless window.
        // Return pending so the client's kick fires
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
      ? modulesArr.length
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
    ingestPhaseRaw === "writing_modules"
      ? ingestPhaseRaw
      : null;

  let previewCourse: CoursePayload | null = null;
  if (
    (outlineReady || row.status === "complete") &&
    outline != null &&
    typeof outline === "object"
  ) {
    previewCourse = buildLivePreviewCourse(outline, modulesArr);
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
    previewCourse,
  });
}
