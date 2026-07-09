import "server-only";
import { report } from "@/lib/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CreateIngestJobFromTextInput = {
  userId: string;
  courseId: string;
  examGroupId: string;
  title: string;
  /** Raw body (without attribution prefix). */
  body: string;
  studyContext?: string;
  outputLanguage?: string | null;
};

export type CreateIngestJobFromTextResult =
  | { ok: true; jobId: string; storagePath: string; transcript: string }
  | { ok: false; error: string; status: number };

/**
 * Upload plain text to the ingest bucket and insert a pdf_ingest_jobs row
 * parked at reviewing_transcript — same handoff as live-notes complete.
 */
export async function createIngestJobFromText(
  supabase: SupabaseClient,
  input: CreateIngestJobFromTextInput
): Promise<CreateIngestJobFromTextResult> {
  const title = input.title.trim() || "Notes";
  const body = input.body.trim();
  if (body.length < 80) {
    return {
      ok: false,
      status: 400,
      error:
        "Need at least a few sentences of notes before building a course.",
    };
  }

  const transcript = `[from ${title} notes]\n${body}`.slice(0, 500_000);

  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      status: 500,
      error:
        "Server is not configured for storage. Set SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const storagePath = `${input.userId}/${crypto.randomUUID()}.txt`;
  const { error: uploadErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .upload(storagePath, new Blob([transcript], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[createIngestJobFromText] upload", uploadErr);
    void report("notes.ingest_upload_failed", uploadErr, {
      userId: input.userId,
    });
    return { ok: false, status: 500, error: "Could not save the notes file." };
  }

  const { count: existingMaterialCount } = await supabase
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("exam_group_id", input.examGroupId);

  const jobInsert: Record<string, unknown> = {
    user_id: input.userId,
    course_id: input.courseId,
    exam_group_id: input.examGroupId,
    storage_path: storagePath,
    original_file_name: `${title}.txt`,
    status: "running",
    ingest_phase: "reviewing_transcript",
    ingest_transcript: transcript,
    source_format: "text",
    material_sort_order: existingMaterialCount ?? 0,
    ...(input.outputLanguage ? { output_language: input.outputLanguage } : {}),
    ...(input.studyContext?.trim()
      ? { study_context: input.studyContext.trim().slice(0, 4000) }
      : {}),
  };

  let { data: jobRow, error: jobErr } = await admin
    .from("pdf_ingest_jobs")
    .insert(jobInsert as never)
    .select("id")
    .single();

  if (
    jobErr &&
    isMissingDbColumnError(
      jobErr,
      "study_context",
      "material_sort_order",
      "output_language"
    )
  ) {
    const minimal = { ...jobInsert };
    delete minimal.study_context;
    delete minimal.material_sort_order;
    delete minimal.output_language;
    ({ data: jobRow, error: jobErr } = await admin
      .from("pdf_ingest_jobs")
      .insert(minimal as never)
      .select("id")
      .single());
  }

  if (jobErr || !jobRow) {
    await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .remove([storagePath])
      .catch(() => {});
    console.error("[createIngestJobFromText] job insert", jobErr);
    return {
      ok: false,
      status: 500,
      error: "Could not start the course build.",
    };
  }

  return {
    ok: true,
    jobId: jobRow.id as string,
    storagePath,
    transcript,
  };
}

/** Ensure a course has at least one exam group; create "My materials" if needed. */
export async function ensureExamGroupForCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<string | null> {
  const { data: firstGroup } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("course_id", courseId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstGroup?.id) return firstGroup.id as string;

  const { data: created } = await supabase
    .from("exam_groups")
    .insert({
      course_id: courseId,
      user_id: userId,
      name: "My materials",
      sort_order: 0,
    })
    .select("id")
    .maybeSingle();
  return (created?.id as string) ?? null;
}
