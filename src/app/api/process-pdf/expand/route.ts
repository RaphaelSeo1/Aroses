import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  runPdfIngestContinueAfterTranscript,
  runPdfIngestExpandOne,
  runPdfIngestJob,
} from "@/lib/pdf-ingest-runner";

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
  const resumeTranscript =
    !!body &&
    typeof body === "object" &&
    (body as { resumeTranscript?: unknown }).resumeTranscript === true;

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
    // Pending jobs: original after() from POST /api/process-pdf may have been
    // dropped. Re-kick phase 1 inline (awaited) so the build self-heals.
    //
    // Live-lecture confirm parks the job at reviewing_transcript / digesting.
    // `after()` on confirm often dies on Vercel; the client POSTs expand with
    // resumeTranscript, and the poller retries while digesting.
    const notReady =
      result.message === "Job is not ready to expand yet." ||
      /outline not ready|Still preparing source material/i.test(result.message);
    if (notReady) {
      const { data: statusRow } = await supabase
        .from("pdf_ingest_jobs")
        .select("status, ingest_phase, ingest_outline")
        .eq("id", jobId)
        .maybeSingle();

      if (statusRow?.status === "pending") {
        await runPdfIngestJob(jobId).catch((e) =>
          console.error("[process-pdf/expand] inline phase1", jobId, e)
        );
        return NextResponse.json({
          complete: false,
          modulesBuilt: 0,
          modulesTotal: 0,
        });
      }

      const phase = (statusRow as { ingest_phase?: string } | null)?.ingest_phase;
      const noOutline =
        (statusRow as { ingest_outline?: unknown } | null)?.ingest_outline ==
        null;
      if (
        statusRow?.status === "running" &&
        noOutline &&
        (phase === "digesting_full_pdf" ||
          (resumeTranscript && phase === "reviewing_transcript"))
      ) {
        await runPdfIngestContinueAfterTranscript(jobId, {
          driveModules: true,
        }).catch((e) =>
          console.error("[process-pdf/expand] resume transcript", jobId, e)
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
