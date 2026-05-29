import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestContinueAfterTranscript } from "@/lib/pdf-ingest-runner";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/**
 * POST body: { transcript: string }
 * Saves edited transcript and continues course outline generation.
 */
export async function POST(request: Request, ctx: Params) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const transcript =
    body &&
    typeof body === "object" &&
    typeof (body as { transcript?: unknown }).transcript === "string"
      ? (body as { transcript: string }).transcript.trim()
      : "";

  if (transcript.length < 80) {
    return NextResponse.json(
      { error: "Transcript is too short to build a course." },
      { status: 400 }
    );
  }

  const { data: job } = await supabase
    .from("pdf_ingest_jobs")
    .select("id, user_id, status, ingest_phase")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (job.status !== "running") {
    return NextResponse.json(
      { error: "This build is not waiting for transcript review." },
      { status: 409 }
    );
  }

  if ((job as { ingest_phase?: string }).ingest_phase !== "reviewing_transcript") {
    return NextResponse.json(
      { error: "This build is not waiting for transcript review." },
      { status: 409 }
    );
  }

  const { error: upErr } = await supabase
    .from("pdf_ingest_jobs")
    .update({
      ingest_transcript: transcript.slice(0, 500_000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (upErr) {
    return NextResponse.json(
      { error: "Could not save transcript." },
      { status: 500 }
    );
  }

  after(() => {
    void runPdfIngestContinueAfterTranscript(jobId).catch((e) =>
      console.error("[confirm-transcript]", jobId, e)
    );
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
