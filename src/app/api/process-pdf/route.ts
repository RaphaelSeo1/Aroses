import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { runPdfIngestExpandOne, runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { hasCourseEdit } from "@/lib/collaboration/api-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  detectIngestFormat,
  MAX_INGEST_BATCH_TOTAL_BYTES,
  MAX_INGEST_FILES_PER_BATCH,
  maxBytesForKind,
} from "@/lib/study-ingest/formats";
import {
  isValidIngestStoragePath,
  UUID_RE,
} from "@/lib/study-ingest/path";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { parseCourseOutputLanguage } from "@/lib/course-output-language";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

export const runtime = "nodejs";

/**
 * Must be a **numeric literal** (Next.js 16). Keep in sync with `PDF_PROCESS_MAX_DURATION_SEC`
 * in `@/lib/pdf-route-duration`. **Vercel Pro:** up to 900 s. **Hobby:** use **60** or deploy fails.
 */
export const maxDuration = 800;

export const dynamic = "force-dynamic";

type IngestFileInput = {
  storagePath: string;
  originalFileName?: string;
};

async function removeIngestObjects(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  paths: string[]
) {
  if (paths.length === 0) return;
  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove(paths)
    .catch(() => {});
}

function parseFilesInput(body: Record<string, unknown>): IngestFileInput[] | null {
  if (Array.isArray(body.files) && body.files.length > 0) {
    const out: IngestFileInput[] = [];
    for (const item of body.files) {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      if (typeof r.storagePath !== "string") return null;
      out.push({
        storagePath: r.storagePath,
        originalFileName:
          typeof r.originalFileName === "string" ? r.originalFileName : undefined,
      });
    }
    return out;
  }

  if (typeof body.storagePath === "string") {
    return [
      {
        storagePath: body.storagePath,
        originalFileName:
          typeof body.originalFileName === "string"
            ? body.originalFileName
            : undefined,
      },
    ];
  }

  return null;
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
      { error: "Expected JSON: courseId, examGroupId, storagePath or files[]." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const { courseId, examGroupId, studyContext, outputLanguage: outputLanguageRaw } =
    raw;
  const studyContextValue =
    typeof studyContext === "string" && studyContext.trim().length > 0
      ? studyContext.trim().slice(0, 4000)
      : null;
  const outputLanguage = parseCourseOutputLanguage(outputLanguageRaw);
  // Upload position within a multi-build batch (parallel POSTs). Used to keep
  // the sidebar in upload order regardless of which build finishes first.
  const orderIndex =
    typeof raw.orderIndex === "number" && Number.isFinite(raw.orderIndex)
      ? Math.max(0, Math.trunc(raw.orderIndex))
      : 0;

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course" }, { status: 400 });
  }

  if (typeof examGroupId !== "string" || !UUID_RE.test(examGroupId)) {
    return NextResponse.json(
      { error: "Choose a section for this upload." },
      { status: 400 }
    );
  }

  const files = parseFilesInput(raw);
  if (!files || files.length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid storagePath / files." },
      { status: 400 }
    );
  }

  if (files.length > MAX_INGEST_FILES_PER_BATCH) {
    return NextResponse.json(
      {
        error: `Too many files (${files.length}). Maximum is ${MAX_INGEST_FILES_PER_BATCH} per course.`,
      },
      { status: 400 }
    );
  }

  const prefix = `${user.id}/`;
  for (const f of files) {
    if (!isValidIngestStoragePath(f.storagePath, user.id)) {
      return NextResponse.json(
        { error: `Invalid ingest file name: ${f.storagePath}` },
        { status: 400 }
      );
    }
    if (!f.storagePath.startsWith(prefix)) {
      return NextResponse.json(
        { error: "Upload path does not match your account." },
        { status: 403 }
      );
    }
    if (f.storagePath.includes("..") || f.storagePath.includes("\\")) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
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

  let totalBytes = 0;
  for (const f of files) {
    const name =
      f.originalFileName?.trim() ||
      f.storagePath.slice(prefix.length);
    const kind = detectIngestFormat(name);
    if (!kind) {
      await removeIngestObjects(admin, files.map((x) => x.storagePath));
      return NextResponse.json(
        { error: `Unsupported file type: ${name}` },
        { status: 400 }
      );
    }
    const { data: blob } = await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .download(f.storagePath);
    if (blob) {
      const buf = Buffer.from(await blob.arrayBuffer());
      totalBytes += buf.length;
      if (buf.length > maxBytesForKind(kind)) {
        await removeIngestObjects(admin, files.map((x) => x.storagePath));
        const maxMb = Math.round(maxBytesForKind(kind) / (1024 * 1024));
        const gotMb = Math.round(buf.length / (1024 * 1024));
        return NextResponse.json(
          {
            error: `${name} is too large (${gotMb}MB). Maximum is ${maxMb}MB for this file type.`,
          },
          { status: 400 }
        );
      }
    }
  }

  if (totalBytes > MAX_INGEST_BATCH_TOTAL_BYTES) {
    await removeIngestObjects(admin, files.map((x) => x.storagePath));
    return NextResponse.json(
      {
        error: `Combined upload exceeds the ${Math.round(MAX_INGEST_BATCH_TOTAL_BYTES / (1024 * 1024 * 1024))}GB limit per course.`,
      },
      { status: 400 }
    );
  }

  const canEdit = await hasCourseEdit(supabase, user.id, courseId);
  if (!canEdit) {
    await removeIngestObjects(admin, files.map((x) => x.storagePath));
    return NextResponse.json({ error: "Course not found" }, { status: 403 });
  }

  const { data: groupOwn } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("id", examGroupId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (!groupOwn) {
    await removeIngestObjects(admin, files.map((x) => x.storagePath));
    return NextResponse.json(
      { error: "Invalid section for this course." },
      { status: 403 }
    );
  }

  const primary = files[0];
  const primaryName =
    primary.originalFileName?.trim() ||
    primary.storagePath.split("/").pop() ||
    "upload";
  const primaryKind = detectIngestFormat(primaryName);

  const sourceFilesJson = files.map((f) => {
    const label =
      f.originalFileName?.trim() ||
      f.storagePath.split("/").pop() ||
      "file";
    return {
      storagePath: f.storagePath,
      originalFileName: label,
      kind: detectIngestFormat(label),
    };
  });

  // Snapshot the current section size so each parallel build in this batch
  // gets a stable, upload-ordered sort_order (count + its upload index). All
  // parallel POSTs read the same count here because materials are only created
  // later at finalize, so the values stay distinct and in upload order.
  const { count: existingMaterialCount } = await supabase
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("exam_group_id", examGroupId);
  const intendedSortOrder = (existingMaterialCount ?? 0) + orderIndex;

  const minimalJobInsert: Record<string, unknown> = {
    user_id: user.id,
    course_id: courseId,
    exam_group_id: examGroupId,
    storage_path: primary.storagePath,
    original_file_name:
      files.length === 1
        ? primaryName
        : `${primaryName} + ${files.length - 1} more`,
    status: "pending",
  };

  const extendedJobInsert: Record<string, unknown> = {
    ...minimalJobInsert,
    source_format: primaryKind,
    source_files: files.length > 1 ? sourceFilesJson : null,
    material_sort_order: intendedSortOrder,
  };

  if (studyContextValue) {
    minimalJobInsert.study_context = studyContextValue;
    extendedJobInsert.study_context = studyContextValue;
  }
  minimalJobInsert.output_language = outputLanguage;
  extendedJobInsert.output_language = outputLanguage;

  let { data: jobRow, error: jobInsErr } = await supabase
    .from("pdf_ingest_jobs")
    .insert(extendedJobInsert as never)
    .select("id")
    .single();

  if (
    jobInsErr &&
    isMissingDbColumnError(
      jobInsErr,
      "source_format",
      "source_files",
      "study_context",
      "output_language",
      "material_sort_order"
    )
  ) {
    const retry = await supabase
      .from("pdf_ingest_jobs")
      .insert(minimalJobInsert as never)
      .select("id")
      .single();
    jobRow = retry.data;
    jobInsErr = retry.error;
  }

  if (jobInsErr || !jobRow) {
    console.error("[process-pdf] insert pdf_ingest_jobs", jobInsErr);
    await removeIngestObjects(admin, files.map((x) => x.storagePath));
    return NextResponse.json(
      {
        error:
          "Could not start the build. Apply database migrations `020_pdf_ingest_jobs.sql`, `021_pdf_ingest_chunked.sql`, and `039_study_ingest_multi_format.sql` in Supabase, then try again.",
        ...(process.env.NODE_ENV === "development" && jobInsErr
          ? { debug: jobInsErr.message }
          : {}),
      },
      { status: 500 }
    );
  }

  const jobId = jobRow.id;

  const { error: langPrefErr } = await supabase
    .from("courses")
    .update({ output_language: outputLanguage })
    .eq("id", courseId);
  if (
    langPrefErr &&
    !isMissingDbColumnError(langPrefErr, "output_language")
  ) {
    console.warn("[process-pdf] could not save output_language preference", langPrefErr);
  }

  const useChunkedPdfIngest = process.env.PDF_INGEST_SYNCHRONOUS !== "1";

  if (useChunkedPdfIngest) {
    after(() => {
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
          : "Build failed. Check the server log and try again.",
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
      e instanceof Error ? e.message : "Unknown error starting build.";
    return NextResponse.json(
      {
        error:
          "Could not start the build on the server. Redeploy the latest code, confirm migrations are applied in Supabase, then try again.",
        ...(process.env.NODE_ENV === "development" ? { debug: hint } : {}),
      },
      { status: 500 }
    );
  }
}
