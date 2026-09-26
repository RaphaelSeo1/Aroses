import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { runPdfIngestExpandOne, runPdfIngestJob } from "@/lib/pdf-ingest-runner";

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
        .select("status")
        .eq("id", jobId)
        .maybeSingle();

      if (statusRow?.status === "pending") {
        // Run phase 1 inline (awaited) rather than via after(). after() shares
        // the parent invocation's budget and Vercel can terminate it early for
        // large PDFs (slow extraction + outline generation). By awaiting here
        // we give phase 1 the full 300 s function window. The client fires this
        // expand call as fire-and-forget so holding the response is invisible.
        await runPdfIngestJob(jobId).catch((e) =>
          console.error("[process-pdf/expand] inline phase1", jobId, e)
        );
        return NextResponse.json({
          complete: false,
          modulesBuilt: 0,
          modulesTotal: 0,
        });
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
