import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestExpandOne, runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** One module expansion — own invocation budget (see `src/app/api/process-pdf/route.ts`). */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON: { jobId }." }, { status: 400 });
  }

  const jobId =
    body && typeof body === "object" && typeof (body as { jobId?: unknown }).jobId === "string"
      ? (body as { jobId: string }).jobId
      : "";

  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("pdf_ingest_jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await runPdfIngestExpandOne(jobId);

  if (result.kind === "failed") {
    // If the job is still pending, phase 1 (extract + outline) hasn't started
    // yet — the original after() in POST /api/process-pdf may have been dropped
    // or delayed. Re-kick it here so the build self-heals without a manual
    // re-upload. The atomic claim inside runPdfIngestJob (eq status=pending)
    // makes re-triggering safe: a duplicate kick is a no-op.
    if (result.message === "Job is not ready to expand yet.") {
      const { data: statusRow } = await supabase
        .from("pdf_ingest_jobs")
        .select("id, status, ingest_outline, updated_at, ingest_epoch")
        .eq("id", jobId)
        .maybeSingle();

      if (statusRow?.status === "pending") {
        after(() => {
          void runPdfIngestJob(jobId).catch((e) =>
            console.error("[process-pdf/expand] kick phase1", jobId, e)
          );
        });
        return NextResponse.json({
          complete: false,
          modulesBuilt: 0,
          modulesTotal: 0,
        });
      }

      // Self-heal stuck `running` jobs that never produced an outline. If the
      // job has been `running` with no outline for >90s, the original phase-1
      // invocation almost certainly died (Vercel cold-start failure, OOM,
      // outline AI stream hang). Reset to pending and re-kick.
      const isRunningNoOutline =
        statusRow?.status === "running" && statusRow?.ingest_outline == null;
      const stale =
        isRunningNoOutline &&
        typeof statusRow.updated_at === "string" &&
        Date.now() - new Date(statusRow.updated_at).getTime() > 90_000;
      if (stale) {
        const admin = createAdminClient();
        if (admin) {
          const prevEpoch =
            typeof (statusRow as { ingest_epoch?: unknown }).ingest_epoch ===
            "number"
              ? (statusRow as { ingest_epoch: number }).ingest_epoch
              : 0;
          const { data: resetRow } = await admin
            .from("pdf_ingest_jobs")
            .update({
              status: "pending",
              ingest_phase: null,
              stream_preview: null,
              ingest_epoch: prevEpoch + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .eq("status", "running")
            .is("ingest_outline", null)
            .select("id")
            .maybeSingle();
          if (resetRow) {
            console.warn("[process-pdf/expand] auto-recovered stale running job", jobId);
            after(() => {
              void runPdfIngestJob(jobId).catch((e) =>
                console.error("[process-pdf/expand] auto-recover phase1", jobId, e)
              );
            });
            return NextResponse.json({
              complete: false,
              modulesBuilt: 0,
              modulesTotal: 0,
            });
          }
        }
      }
    }

    const msg = result.message;
    const rateLimited =
      /rate limit|too many ai requests|tokens per minute|output tokens|exceed your organization/i.test(
        msg
      );
    return NextResponse.json(
      { error: msg },
      { status: rateLimited ? 429 : 500 }
    );
  }

  if (result.kind === "complete") {
    return NextResponse.json({
      complete: true,
      materialId: result.materialId,
    });
  }

  return NextResponse.json({
    complete: false,
    modulesBuilt: result.modulesBuilt,
    modulesTotal: result.modulesTotal,
  });
}
