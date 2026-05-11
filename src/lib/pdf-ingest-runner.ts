import { RateLimitError, APIError } from "@anthropic-ai/sdk";
import pdfParse from "pdf-parse";
import { generateCourseFromMaterial } from "@/lib/ai/study-generation";
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

/**
 * Background pipeline: claim job → download PDF from ingest storage → AI → study_materials.
 * Uses service role only (no cookies). Updates `pdf_ingest_jobs` and deletes ingest object.
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

  let payload;
  try {
    payload = await generateCourseFromMaterial(text);
  } catch (e) {
    console.error("[pdf-ingest] AI", jobId, e);
    if (e instanceof RateLimitError) {
      await failJob(
        admin,
        jobId,
        storagePath,
        "The AI service rate limit was hit. Wait one minute and try again."
      );
      return;
    }
    if (e instanceof APIError && typeof e.status === "number") {
      if (e.status === 529 || e.status === 503) {
        await failJob(
          admin,
          jobId,
          storagePath,
          "The AI service is temporarily overloaded. Try again in a few minutes."
        );
        return;
      }
      if (e.status === 429) {
        await failJob(
          admin,
          jobId,
          storagePath,
          "Too many AI requests right now. Wait a minute and retry this file."
        );
        return;
      }
    }
    const msg = e instanceof Error ? e.message : "";
    if (msg === "Missing ANTHROPIC_API_KEY") {
      await failJob(
        admin,
        jobId,
        storagePath,
        "Server is not configured for AI. Contact support."
      );
      return;
    }
    if (msg.includes("Claude did not return valid JSON")) {
      await failJob(
        admin,
        jobId,
        storagePath,
        "The model returned an incomplete response. Try uploading again, or use a smaller PDF."
      );
      return;
    }
    await failJob(
      admin,
      jobId,
      storagePath,
      "AI processing failed (network or model timeout). Try again in a moment."
    );
    return;
  }

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
    return;
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

  console.info("[pdf-ingest] ok", {
    jobId,
    ms: Date.now() - t0,
    materialId: row.id,
  });
}
