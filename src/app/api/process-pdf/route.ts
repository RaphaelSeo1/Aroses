import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestExpandOne, runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

export const runtime = "nodejs";

/**
 * Must be a **numeric literal** (Next.js 16). Keep in sync with `PDF_PROCESS_MAX_DURATION_SEC`
 * in `@/lib/pdf-route-duration`. **Vercel Pro:** up to 900 s. **Hobby:** use **60** or deploy fails.
 *
 * Set to 800 so the after() callback can drive both phase 1 (extract + outline, ~3-5 min)
 * AND all module writes (phase 2, ~30-60 s × N modules) in a single invocation, letting
 * uploads complete even when the user navigates away before the client's polling loop fires.
 */
export const maxDuration = 800;

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

  const { courseId, examGroupId, storagePath, originalFileName, studyContext } =
    body as {
      courseId?: unknown;
      examGroupId?: unknown;
      storagePath?: unknown;
      originalFileName?: unknown;
      // Per-upload goal that overrides the course-level `study_context` for
      // this specific lecture. Optional; falls back to course context.
      studyContext?: unknown;
    };
  const studyContextValue =
    typeof studyContext === "string" && studyContext.trim().length > 0
      ? studyContext.trim().slice(0, 4000)
      : null;

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
    .maybeSingle();

  if (!groupOwn) {
    await removeIngestObject(admin, storagePath);
    return NextResponse.json(
      { error: "Invalid section for this course." },
      { status: 403 }
    );
  }

  const baseJobInsert = {
    user_id: user.id,
    course_id: courseId,
    exam_group_id: examGroupId,
    storage_path: storagePath,
    original_file_name:
      typeof originalFileName === "string" && originalFileName.trim().length > 0
        ? originalFileName.trim()
        : null,
    status: "pending",
  };

  // `study_context` is part of migration 030; cast through `any` so the
  // generated Supabase types (which may predate the migration) don't reject
  // the field at compile time. The runtime fallback below covers the case
  // where the column genuinely isn't there yet.
  let { data: jobRow, error: jobInsErr } = await supabase
    .from("pdf_ingest_jobs")
    .insert(
      (studyContextValue
        ? { ...baseJobInsert, study_context: studyContextValue }
        : baseJobInsert) as never
    )
    .select("id")
    .single();

  // Migration `030_pdf_ingest_per_upload_study_context.sql` adds the new
  // `study_context` column. If that hasn't been applied yet the insert will
  // fail with code 42703 (undefined_column) — retry without the field so
  // uploads keep working until the operator applies migrations.
  if (jobInsErr && studyContextValue) {
    const isMissingCol =
      jobInsErr.code === "42703" ||
      (jobInsErr.message ?? "").includes("study_context") ||
      (jobInsErr.message ?? "").includes("schema cache");
    if (isMissingCol) {
      console.warn(
        "[process-pdf] study_context column missing; retrying without per-upload context"
      );
      const fallback = await supabase
        .from("pdf_ingest_jobs")
        .insert(baseJobInsert)
        .select("id")
        .single();
      jobRow = fallback.data;
      jobInsErr = fallback.error;
    }
  }

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

  /**
   * Return `202` + `jobId` and run phase 1 in `after()` so the client can redirect to the course
   * page and poll (same UX as production). On Vercel, `VERCEL=1`. In `next dev`, `NODE_ENV` is
   * `development` — use chunked there too so local matches the deployed app. For a local
   * production build (`next start`) without `VERCEL`, set `PDF_INGEST_CHUNKED=1` in `.env` to
   * opt into this path; otherwise the handler falls through to the monolithic response below.
   */
  const useChunkedPdfIngest =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "development" ||
    process.env.PDF_INGEST_CHUNKED === "1";

  if (useChunkedPdfIngest) {
    after(() => {
      // Mirror the manual "Restart this PDF" flow exactly: phase 1 only,
      // worker exits after outline is saved, browser polling drives `/expand`
      // for each module (each gets its own 5-minute Vercel budget).
      //
      // The previous `driveModules: true` path tried to do extract + outline
      // + ALL modules in a single 5 min invocation. For N>4 modules or any
      // queue/429-backoff wait the worker would hit `maxDuration`, get
      // killed, and the auto-recovery would loop the job back to
      // `reading_pdf` indefinitely. Restart works because it does *not* set
      // driveModules — match that.
      //
      // Trade-off: if the user closes the tab before modules finish, module
      // writing pauses (no client to drive `/expand`). They can reopen the
      // course and click Restart to resume. Far better than the broken loop.
      void runPdfIngestJob(jobId).catch((e) =>
        console.error("[process-pdf] after()", jobId, e)
      );
    });
    return NextResponse.json({ jobId }, { status: 202 });
  }

  await runPdfIngestJob(jobId).catch((e) =>
    console.error("[process-pdf] monolith job phase1", jobId, e)
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
