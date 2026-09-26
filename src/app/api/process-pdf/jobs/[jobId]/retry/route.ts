import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/**
 * Reset a stuck PDF ingest job to `pending` and re-queue phase 1.
 * When a completed job is restarted the old study_materials row is deleted
 * first so the next build doesn't leave a duplicate in the course.
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

  // Need admin client for storage checks and the cleanup delete below.
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server is not configured for storage." },
      { status: 500 }
    );
  }

  const { data: job, error: selErr } = await supabase
    .from("pdf_ingest_jobs")
    .select("id, status, material_id, storage_path, ingest_epoch")
    .eq("id", jobId)
    .maybeSingle();

  if (selErr || !job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (job.status === "failed") {
    return NextResponse.json(
      {
        error:
          "This build failed and the uploaded copy was removed from storage. Upload the PDF again from your course page.",
      },
      { status: 400 }
    );
  }

  const storagePath =
    typeof job.storage_path === "string" && job.storage_path.length > 0
      ? job.storage_path
      : null;
  if (!storagePath) {
    return NextResponse.json(
      { error: "Job has no stored file path." },
      { status: 400 }
    );
  }

  const { error: dlErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .download(storagePath);
  if (dlErr) {
    return NextResponse.json(
      {
        error:
          "The original PDF is no longer in storage, so this build cannot be restarted. Upload the file again from your course page.",
      },
      { status: 400 }
    );
  }

  // If a previous run already produced a study_materials row, delete it before
  // resetting so the fresh rebuild doesn't leave a duplicate in the course.
  const oldMaterialId =
    typeof job.material_id === "string" && job.material_id.length > 0
      ? job.material_id
      : null;
  if (oldMaterialId) {
    const { error: delErr } = await admin
      .from("study_materials")
      .delete()
      .eq("id", oldMaterialId);
    if (delErr) {
      console.warn("[process-pdf/retry] delete old material", oldMaterialId, delErr);
    }
  }

  const restartedAt = new Date().toISOString();
  const prevEpoch =
    typeof job.ingest_epoch === "number" && Number.isFinite(job.ingest_epoch)
      ? job.ingest_epoch
      : 0;

  const { error: upErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "pending",
      error_message: null,
      material_id: null,
      ingest_source_text: null,
      ingest_outline: null,
      ingest_modules: [],
      stream_preview: null,
      ingest_preview_outline: null,
      ingest_phase: null,
      ingest_epoch: prevEpoch + 1,
      updated_at: restartedAt,
    })
    .eq("id", jobId);

  if (upErr) {
    console.error("[process-pdf/retry] update", jobId, upErr);
    return NextResponse.json(
      { error: "Could not reset this job. Try again in a moment." },
      { status: 500 }
    );
  }

  // Same scheduling as POST /api/process-pdf: chunked, server-driven build.
  // (The old env-dependent monolith path diverged from the main route and is
  // gone; retries now always behave like fresh uploads.)
  after(() => {
    void runPdfIngestJob(jobId, { driveModules: true }).catch((e) =>
      console.error("[process-pdf/retry] after()", jobId, e)
    );
  });

  return NextResponse.json({ ok: true as const, restartedAt });
}
