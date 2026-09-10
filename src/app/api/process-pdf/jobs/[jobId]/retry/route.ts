import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import {
  ingestJobRowToRetryView,
  resolveIngestRetrySource,
  type LinkedNotesSource,
} from "@/lib/notes/ingest-job-retry";
import { runPdfIngestJob } from "@/lib/pdf-ingest-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

async function loadLinkedNotesSource(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string
): Promise<LinkedNotesSource | null> {
  const noteQuery = admin
    .from("user_notes")
    .select("id, content_text, deleted_at")
    .eq("ingest_job_id", jobId)
    .limit(1)
    .maybeSingle();
  let { data: note, error: noteErr } = await noteQuery;
  if (noteErr && /deleted_at/i.test(noteErr.message ?? "")) {
    ({ data: note, error: noteErr } = await admin
      .from("user_notes")
      .select("id, content_text")
      .eq("ingest_job_id", jobId)
      .limit(1)
      .maybeSingle());
  }

  const { data: session } = await admin
    .from("live_lecture_sessions")
    .select("id, notes_text")
    .eq("ingest_job_id", jobId)
    .limit(1)
    .maybeSingle();

  const noteAlive =
    note &&
    typeof note.id === "string" &&
    (note as { deleted_at?: string | null }).deleted_at == null;
  const sessionAlive = session && typeof session.id === "string";
  if (!noteAlive && !sessionAlive) return null;

  const noteBody =
    note && noteAlive && typeof note.content_text === "string"
      ? note.content_text
      : "";
  const sessionBody =
    session && sessionAlive && typeof session.notes_text === "string"
      ? session.notes_text
      : "";
  const body =
    noteBody.trim().length >= sessionBody.trim().length ? noteBody : sessionBody;
  return { exists: true, body };
}

/**
 * Reset a stuck or failed ingest job to `pending` and re-queue phase 1.
 * Notes/live-lecture text jobs restore from transcript or the still-present
 * note even when failure cleanup deleted the storage object.
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

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server is not configured for storage." },
      { status: 500 }
    );
  }

  const JOB_RETRY_SELECT =
    "id, status, material_id, storage_path, ingest_epoch, ingest_transcript, source_format, original_file_name";
  let { data: job, error: selErr } = await supabase
    .from("pdf_ingest_jobs")
    .select(JOB_RETRY_SELECT)
    .eq("id", jobId)
    .maybeSingle();

  if (selErr && isMissingDbColumnError(selErr, "ingest_transcript", "source_format")) {
    ({ data: job, error: selErr } = await supabase
      .from("pdf_ingest_jobs")
      .select("id, status, material_id, storage_path, ingest_epoch, original_file_name")
      .eq("id", jobId)
      .maybeSingle());
  }

  if (selErr || !job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const view = ingestJobRowToRetryView(job);
  if (!view) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let storagePath =
    typeof job.storage_path === "string" && job.storage_path.length > 0
      ? job.storage_path
      : null;

  let storagePresent = false;
  if (storagePath) {
    const { error: dlErr } = await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .download(storagePath);
    storagePresent = !dlErr;
  }

  if (!storagePresent) {
    const linkedNote = await loadLinkedNotesSource(admin, jobId);
    const decision = resolveIngestRetrySource({
      storagePresent: false,
      job: view,
      linkedNote,
    });
    if (decision.action === "reject") {
      return NextResponse.json({ error: decision.error }, { status: 400 });
    }
    if (decision.action === "restore_text") {
      const path = storagePath ?? `${user.id}/${crypto.randomUUID()}.txt`;
      const { error: uploadErr } = await admin.storage
        .from(STUDY_PDF_INGEST_BUCKET)
        .upload(path, new Blob([decision.text], { type: "text/plain" }), {
          contentType: "text/plain",
          upsert: true,
        });
      if (uploadErr) {
        console.error("[process-pdf/retry] restore upload", jobId, uploadErr);
        return NextResponse.json(
          {
            error:
              "Could not restore the notes file. Try building the course from your notes again.",
          },
          { status: 500 }
        );
      }
      storagePath = path;
    }
  }

  if (!storagePath) {
    return NextResponse.json(
      { error: "Job has no stored file path." },
      { status: 400 }
    );
  }

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
      storage_path: storagePath,
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

  after(() => {
    void runPdfIngestJob(jobId, { driveModules: true }).catch((e) =>
      console.error("[process-pdf/retry] after()", jobId, e)
    );
  });

  return NextResponse.json({ ok: true as const, restartedAt });
}
