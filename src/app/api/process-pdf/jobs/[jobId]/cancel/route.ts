import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/**
 * Cancel an in-progress PDF ingest job. Bumps `ingest_epoch` so any running
 * worker/expand invocation abandons in-flight work, then marks the job failed.
 */
export async function POST(_request: Request, ctx: Params) {
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

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server is not configured for storage." },
      { status: 500 }
    );
  }

  const { data: job, error: selErr } = await supabase
    .from("pdf_ingest_jobs")
    .select("id, status, ingest_epoch")
    .eq("id", jobId)
    .maybeSingle();

  if (selErr || !job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (job.status === "complete") {
    return NextResponse.json(
      { error: "This build already finished." },
      { status: 400 }
    );
  }

  if (job.status === "failed") {
    return NextResponse.json({ ok: true as const, alreadyStopped: true });
  }

  const cancelledAt = new Date().toISOString();
  const prevEpoch =
    typeof job.ingest_epoch === "number" && Number.isFinite(job.ingest_epoch)
      ? job.ingest_epoch
      : 0;

  const { error: upErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "failed",
      error_message: "Build cancelled.",
      ingest_phase: null,
      ingest_epoch: prevEpoch + 1,
      updated_at: cancelledAt,
    })
    .eq("id", jobId);

  if (upErr) {
    console.error("[process-pdf/cancel] update", jobId, upErr);
    return NextResponse.json(
      { error: "Could not stop this build. Try again in a moment." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true as const, cancelledAt });
}
