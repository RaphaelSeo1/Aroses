import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestExpandOne, runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

export const runtime = "nodejs";

/**
 * Must be a **numeric literal** (Next.js 16). Keep in sync with `PDF_PROCESS_MAX_DURATION_SEC`
 * in `@/lib/pdf-route-duration`. **Vercel Pro:** 300s max. **Hobby:** use **60** or deploy fails.
 */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INGEST_OBJECT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

async function removeIngestObject(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  storagePath: string
) {
  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove([storagePath])
    .catch(() => {});
}

async function handleProcessPdfPost(request: Request): Promise<Response> {
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
    return NextResponse.json(
      { error: "Expected JSON: courseId, examGroupId, storagePath." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { courseId, examGroupId, storagePath, originalFileName } = body as {
    courseId?: unknown;
    examGroupId?: unknown;
    storagePath?: unknown;
    originalFileName?: unknown;
  };

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course" }, { status: 400 });
  }

  if (typeof examGroupId !== "string" || !UUID_RE.test(examGroupId)) {
    return NextResponse.json(
      { error: "Choose a section for this upload." },
      { status: 400 }
    );
  }

  if (typeof storagePath !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid storagePath." },
      { status: 400 }
    );
  }

  const prefix = `${user.id}/`;
  if (!storagePath.startsWith(prefix)) {
    return NextResponse.json(
      { error: "Upload path does not match your account." },
      { status: 403 }
    );
  }

  const objectKey = storagePath.slice(prefix.length);
  if (!INGEST_OBJECT_RE.test(objectKey)) {
    return NextResponse.json(
      { error: "Invalid ingest file name." },
      { status: 400 }
    );
  }

  if (storagePath.includes("..") || storagePath.includes("\\")) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      {
        error:
          "Server is not configured for storage. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY (and NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL) on the host, then redeploy.",
      },
      { status: 500 }
    );
  }

  const { data: courseOwn } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!courseOwn) {
    await removeIngestObject(admin, storagePath);
    return NextResponse.json({ error: "Course not found" }, { status: 403 });
  }

  const { data: groupOwn } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("id", examGroupId)
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!groupOwn) {
    await removeIngestObject(admin, storagePath);
    return NextResponse.json(
      { error: "Invalid section for this course." },
      { status: 403 }
    );
  }

  const { data: jobRow, error: jobInsErr } = await supabase
    .from("pdf_ingest_jobs")
    .insert({
      user_id: user.id,
      course_id: courseId,
      exam_group_id: examGroupId,
      storage_path: storagePath,
      original_file_name:
        typeof originalFileName === "string" && originalFileName.trim().length > 0
          ? originalFileName.trim()
          : null,
      status: "pending",
    })
    .select("id")
    .single();

  if (jobInsErr || !jobRow) {
    console.error("[process-pdf] insert pdf_ingest_jobs", jobInsErr);
    await removeIngestObject(admin, storagePath);
    return NextResponse.json(
      {
        error:
          "Could not start PDF build. Apply database migrations `020_pdf_ingest_jobs.sql` and `021_pdf_ingest_chunked.sql` in Supabase, then try again.",
        ...(process.env.NODE_ENV === "development" && jobInsErr
          ? { debug: jobInsErr.message }
          : {}),
      },
      { status: 500 }
    );
  }

  const jobId = jobRow.id;

  /** Vercel sets `VERCEL=1`; run the heavy pipeline after we return 202 so the gateway sees a fast response. */
  if (process.env.VERCEL) {
    after(() => {
      void runPdfIngestJob(jobId).catch((e) =>
        console.error("[process-pdf] after()", jobId, e)
      );
    });
    return NextResponse.json({ jobId }, { status: 202 });
  }

  await runPdfIngestJob(jobId).catch((e) =>
    console.error("[process-pdf] dev job phase1", jobId, e)
  );

  for (let step = 0; step < 24; step++) {
    const r = await runPdfIngestExpandOne(jobId);
    if (r.kind === "complete") {
      return NextResponse.json({ materialId: r.materialId });
    }
    if (r.kind === "failed") {
      return NextResponse.json({ error: r.message }, { status: 500 });
    }
  }

  const { data: done } = await admin
    .from("pdf_ingest_jobs")
    .select("status, material_id, error_message")
    .eq("id", jobId)
    .maybeSingle();

  if (done?.status === "complete" && done.material_id) {
    return NextResponse.json({ materialId: done.material_id });
  }

  return NextResponse.json(
    {
      error:
        typeof done?.error_message === "string" && done.error_message.trim()
          ? done.error_message.trim()
          : "PDF build failed. Check the server log and try again.",
    },
    { status: 500 }
  );
}

export async function POST(request: Request) {
  try {
    return await handleProcessPdfPost(request);
  } catch (e) {
    console.error("[process-pdf] POST uncaught", e);
    const hint =
      e instanceof Error ? e.message : "Unknown error starting PDF build.";
    return NextResponse.json(
      {
        error:
          "Could not start the PDF build on the server. Redeploy the latest code, confirm migrations 020 and 021 (pdf ingest) are applied in Supabase, then try again.",
        ...(process.env.NODE_ENV === "development" ? { debug: hint } : {}),
      },
      { status: 500 }
    );
  }
}
