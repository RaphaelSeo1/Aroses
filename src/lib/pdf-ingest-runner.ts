import { RateLimitError, APIError } from "@anthropic-ai/sdk";
import pdfParse from "pdf-parse";
import {
  parseCourseModule,
  parseCourseOutlinePayload,
  renumberModules,
} from "@/lib/ai/course-payload";
import type { CourseModule } from "@/types/course";
import type { CourseOutlinePayload } from "@/lib/ai/course-payload";
import type { CoursePayload } from "@/types/course";
import {
  generateCourseModuleFromMaterial,
  generateCourseOutlineFromMaterial,
  materialTextForPdfIngest,
} from "@/lib/ai/study-generation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_STUDY_PDF_BYTES,
  STUDY_PDF_INGEST_BUCKET,
} from "@/lib/study-pdf-ingest";
import {
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
  stripKnownDocumentExtension,
} from "@/lib/study-material-display-name";

async function removeIngestObject(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  storagePath: string
) {
  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove([storagePath])
    .catch(() => {});
}

function truncateErr(msg: string, max = 400): string {
  const t = msg.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

async function touchJobProgress(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function failJob(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  storagePath: string,
  message: string
) {
  await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "failed",
      error_message: truncateErr(message),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  await removeIngestObject(admin, storagePath);
}

function mapAiFailureToMessage(jobId: string, e: unknown): string {
  console.error("[pdf-ingest] AI", jobId, e);
  if (e instanceof RateLimitError) {
    return "The AI service rate limit was hit. Wait one minute and try again.";
  }
  if (e instanceof APIError && typeof e.status === "number") {
    if (e.status === 404) {
      return "The configured AI model is not available (404). Update ANTHROPIC_COURSE_MODEL or redeploy — fast profile uses Claude Haiku 4.5.";
    }
    if (e.status === 529 || e.status === 503) {
      return "The AI service is temporarily overloaded. Try again in a few minutes.";
    }
    if (e.status === 429) {
      return "Too many AI requests right now. Wait a minute and retry this file.";
    }
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "Missing ANTHROPIC_API_KEY") {
    return "Server is not configured for AI. Contact support.";
  }
  if (msg.includes("Claude did not return valid JSON")) {
    return "The model returned an incomplete response. Try uploading again, or use a smaller PDF.";
  }
  return "AI processing failed (network or model timeout). Try again in a moment.";
}

function parseStoredModules(raw: unknown): CourseModule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => parseCourseModule(m));
}

async function finalizePdfIngest(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
  userId: string,
  courseId: string,
  examGroupId: string,
  storagePath: string,
  originalFileName: string | null,
  outline: CourseOutlinePayload,
  modulesRaw: CourseModule[]
): Promise<{ materialId: string } | null> {
  const modules = renumberModules(modulesRaw);
  const payload: CoursePayload = {
    title: outline.title,
    description: outline.description,
    modules,
  };

  const { data: minRow } = await admin
    .from("study_materials")
    .select("sort_order")
    .eq("exam_group_id", examGroupId)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  const nextSortOrder =
    typeof minRow?.sort_order === "number" ? minRow.sort_order - 1 : 0;

  const stemFromContent = deriveFileStemFromPayload(payload);
  const uploadLabel =
    typeof originalFileName === "string" && originalFileName.trim().length > 0
      ? originalFileName.trim()
      : "upload.pdf";
  const fromUploadStem =
    stripKnownDocumentExtension(uploadLabel) ||
    finalizeMaterialSectionLabel(uploadLabel);
  const storedFileName = stemFromContent
    ? finalizeMaterialSectionLabel(stemFromContent)
    : fromUploadStem.length > 0
      ? fromUploadStem
      : "Material";

  const { data: row, error: insErr } = await admin
    .from("study_materials")
    .insert({
      user_id: userId,
      course_id: courseId,
      exam_group_id: examGroupId,
      file_name: storedFileName,
      summary: payload.description,
      key_concepts: [] as string[],
      questions: [] as unknown[],
      course_payload: payload,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

  if (insErr || !row) {
    console.error("[pdf-ingest] insert study_materials", jobId, insErr);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not save study material."
    );
    return null;
  }

  await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "complete",
      material_id: row.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await removeIngestObject(admin, storagePath);

  return { materialId: row.id };
}

export type PdfIngestExpandResult =
  | { kind: "complete"; materialId: string }
  | { kind: "failed"; message: string }
  | { kind: "progress"; modulesBuilt: number; modulesTotal: number };

/**
 * Append the next module (or finalize if already complete). Each call is intended to run
 * in its own serverless invocation so Anthropic stays under the host wall clock.
 */
export async function runPdfIngestExpandOne(
  jobId: string
): Promise<PdfIngestExpandResult> {
  const admin = createAdminClient();
  if (!admin) {
    return { kind: "failed", message: "Server storage is not configured." };
  }

  const { data: job, error: loadErr } = await admin
    .from("pdf_ingest_jobs")
    .select(
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name, status, material_id, error_message, ingest_source_text, ingest_outline, ingest_modules"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (loadErr || !job) {
    return { kind: "failed", message: "Job not found." };
  }

  if (job.status === "complete" && job.material_id) {
    return { kind: "complete", materialId: job.material_id };
  }

  if (job.status === "failed") {
    const em =
      typeof job.error_message === "string" && job.error_message.trim()
        ? job.error_message.trim()
        : "PDF build failed.";
    return { kind: "failed", message: em };
  }

  if (job.status !== "running") {
    return { kind: "failed", message: "Job is not ready to expand yet." };
  }

  if (job.ingest_outline == null || job.ingest_source_text == null) {
    return {
      kind: "failed",
      message:
        "Chunked ingest columns missing or outline not ready. Apply migration 021_pdf_ingest_chunked.sql and try again.",
    };
  }

  let outline: CourseOutlinePayload;
  try {
    outline = parseCourseOutlinePayload(job.ingest_outline as unknown);
  } catch (e) {
    console.error("[pdf-ingest] bad ingest_outline", jobId, e);
    await failJob(
      admin,
      jobId,
      job.storage_path,
      "Stored course outline was invalid. Try uploading the PDF again."
    );
    return { kind: "failed", message: "Invalid stored outline." };
  }

  const storagePath = job.storage_path;
  let modulesBuilt: CourseModule[];
  try {
    modulesBuilt = parseStoredModules(job.ingest_modules);
  } catch (e) {
    console.error("[pdf-ingest] corrupt ingest_modules", jobId, e);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Saved module data was invalid. Try uploading the PDF again."
    );
    return { kind: "failed", message: "Saved module data was invalid." };
  }

  const n = outline.modules.length;
  const prefix = modulesBuilt.slice(0, n);

  if (prefix.length >= n) {
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.user_id,
      job.course_id,
      job.exam_group_id,
      storagePath,
      job.original_file_name,
      outline,
      prefix
    );
    if (!fin) {
      return { kind: "failed", message: "Could not save study material." };
    }
    return { kind: "complete", materialId: fin.materialId };
  }

  const idx = prefix.length;
  await touchJobProgress(admin, jobId);
  let newMod: CourseModule;
  try {
    newMod = await generateCourseModuleFromMaterial(
      job.ingest_source_text,
      outline,
      idx
    );
  } catch (e) {
    const message = mapAiFailureToMessage(jobId, e);
    await failJob(admin, jobId, storagePath, message);
    return { kind: "failed", message };
  }

  const nextModules = [...prefix, newMod];
  const cappedNext = nextModules.slice(0, n);
  const { error: upErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      ingest_modules: nextModules,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (upErr) {
    console.error("[pdf-ingest] update ingest_modules", jobId, upErr);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not save module progress. Try uploading again."
    );
    return { kind: "failed", message: "Could not save module progress." };
  }

  if (cappedNext.length >= n) {
    const fin = await finalizePdfIngest(
      admin,
      jobId,
      job.user_id,
      job.course_id,
      job.exam_group_id,
      storagePath,
      job.original_file_name,
      outline,
      cappedNext
    );
    if (!fin) {
      return { kind: "failed", message: "Could not save study material." };
    }
    return { kind: "complete", materialId: fin.materialId };
  }

  return {
    kind: "progress",
    modulesBuilt: nextModules.length,
    modulesTotal: n,
  };
}

/**
 * Background phase 1: claim job → download PDF → extract text → course outline → DB.
 * Client then calls `POST /api/process-pdf/expand` (or dev runs `runPdfIngestExpandOne` in a loop).
 */
export async function runPdfIngestJob(jobId: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("[pdf-ingest] missing SUPABASE_SERVICE_ROLE_KEY", jobId);
    return;
  }

  const { data: claimed, error: claimErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      status: "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select(
      "id, user_id, course_id, exam_group_id, storage_path, original_file_name"
    )
    .maybeSingle();

  if (claimErr) {
    console.error("[pdf-ingest] claim", jobId, claimErr);
    return;
  }
  if (!claimed) {
    return;
  }

  const {
    user_id: userId,
    course_id: courseId,
    exam_group_id: examGroupId,
    storage_path: storagePath,
    original_file_name: originalFileName,
  } = claimed;

  const t0 = Date.now();

  let buf: Buffer;
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .download(storagePath);

    if (dlErr || !blob) {
      console.error("[pdf-ingest] download", jobId, dlErr);
      await failJob(
        admin,
        jobId,
        storagePath,
        "Could not read the uploaded PDF from storage. Try uploading again."
      );
      return;
    }

    buf = Buffer.from(await blob.arrayBuffer());
  } catch (e) {
    console.error("[pdf-ingest] download unexpected", jobId, e);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not read the uploaded PDF from storage."
    );
    return;
  }

  if (buf.length > MAX_STUDY_PDF_BYTES) {
    await failJob(
      admin,
      jobId,
      storagePath,
      "PDF is too large for this server (max 40 MB). Split the file or export fewer pages."
    );
    return;
  }

  console.info("[pdf-ingest] start", {
    jobId,
    bytes: buf.length,
    path: storagePath.slice(0, 80),
  });

  let text = "";
  try {
    const parsed = await pdfParse(buf);
    text = (parsed.text ?? "").trim();
  } catch {
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not read PDF. Try another file."
    );
    return;
  }

  if (text.length < 80) {
    await failJob(
      admin,
      jobId,
      storagePath,
      "Not enough text extracted from this PDF. Try slides with selectable text or another file."
    );
    return;
  }

  /** So job polling does not treat a long outline model call as “stuck” (see job GET stale rules). */
  await touchJobProgress(admin, jobId);

  const storedMaterial = materialTextForPdfIngest(text);

  let outline: CourseOutlinePayload;
  try {
    outline = await generateCourseOutlineFromMaterial(text);
  } catch (e) {
    const message = mapAiFailureToMessage(jobId, e);
    await failJob(admin, jobId, storagePath, message);
    return;
  }

  const { error: outlineErr } = await admin
    .from("pdf_ingest_jobs")
    .update({
      ingest_source_text: storedMaterial,
      ingest_outline: outline,
      ingest_modules: [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (outlineErr) {
    console.error("[pdf-ingest] persist outline", jobId, outlineErr);
    await failJob(
      admin,
      jobId,
      storagePath,
      "Could not save outline. Apply migration 021_pdf_ingest_chunked.sql in Supabase, then try again."
    );
    return;
  }

  console.info("[pdf-ingest] outline ok", {
    jobId,
    ms: Date.now() - t0,
    modules: outline.modules.length,
  });
}
