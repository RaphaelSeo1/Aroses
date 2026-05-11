import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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
      "status, material_id, error_message, updated_at, created_at, ingest_outline, ingest_modules"
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
    return NextResponse.json({
      status: "failed",
      materialId: undefined,
      error:
        "This build stopped making progress for a long time (the server may have hit a time limit or lost the connection). Try uploading the PDF again on a stable network. Hard-refresh the page first so your browser runs the latest upload code. Confirm migrations 020–021 are applied in Supabase and the service role key is set on the host.",
      outlineReady: false,
      modulesBuilt: 0,
      modulesTotal: 0,
      createdAt:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at.trim()
          : undefined,
    });
  }

  const outline = row.ingest_outline as { modules?: unknown[] } | null;
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
  });
}
