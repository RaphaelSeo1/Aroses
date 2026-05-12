import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/**
 * Reset a stuck PDF ingest job to `pending` and re-queue phase 1.
 * Does not apply after `complete` (material saved) or `failed` (ingest file was removed).
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

  const { data: job, error: selErr } = await supabase
    .from("pdf_ingest_jobs")
    .select("id, status, material_id, storage_path")
    .eq("id", jobId)
    .maybeSingle();

  if (selErr || !job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (job.status === "complete" && job.material_id) {
    return NextResponse.json(
      { error: "This build already finished. Open it in the study editor." },
      { status: 400 }
    );
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

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server is not configured for storage." },
      { status: 500 }
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

  const restartedAt = new Date().toISOString();

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
      updated_at: restartedAt,
    })
    .eq("id", jobId)
    .eq("user_id", user.id);

  if (upErr) {
    console.error("[process-pdf/retry] update", jobId, upErr);
    return NextResponse.json(
      { error: "Could not reset this job. Try again in a moment." },
      { status: 500 }
    );
  }

  const useChunkedPdfIngest =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "development" ||
    process.env.PDF_INGEST_CHUNKED === "1";

  if (useChunkedPdfIngest) {
    after(() => {
      void runPdfIngestJob(jobId).catch((e) =>
        console.error("[process-pdf/retry] after()", jobId, e)
      );
    });
  } else {
    void runPdfIngestJob(jobId).catch((e) =>
      console.error("[process-pdf/retry] sync", jobId, e)
    );
  }

  return NextResponse.json({ ok: true as const, restartedAt });
}
