/**
 * Shared rules for retrying notes → course (and live-lecture wrap-up)
 * when an ingest job dies mid-run.
 *
 * A Vercel timeout or crashed runner leaves `pdf_ingest_jobs` as running/failed
 * with storage deleted. The source note/session is usually still there — never
 * tell the student their notes are lost unless that row is actually missing.
 */

export const NOTES_SOURCE_MIN_CHARS = 80;

/** Match GET /api/process-pdf/jobs/[jobId] pending stale budget. */
export const STALE_PENDING_MS = 15 * 60 * 1000 + 30_000;
/** Match GET /api/process-pdf/jobs/[jobId] running stale budget. */
export const STALE_RUNNING_MS = 18 * 60 * 1000 + 30_000;
/**
 * No `updated_at` heartbeat for this long means the worker is dead.
 * Live extract/digest/outline heartbeats are 8s; reviewing_transcript is
 * a user pause and is never treated as a dead worker.
 */
export const DEAD_WORKER_MS = 90_000;

export const NOTES_LOST_ERROR =
  "These notes are no longer available, so this build cannot be restarted.";

export const PDF_STORAGE_LOST_ERROR =
  "The original PDF is no longer in storage, so this build cannot be restarted. Upload the file again from your course page.";

export const NOTES_TOO_SHORT_ERROR =
  "Need at least a few sentences of notes before building a course.";

export const NOTES_RESTORE_FAILED_ERROR =
  "Could not restore the notes file. Try building the course from your notes again.";

export type IngestJobRetryView = {
  status: string | null;
  updatedAt: string | null;
  ingestPhase: string | null;
  ingestTranscript: string | null;
  sourceFormat: string | null;
  originalFileName: string | null;
  storagePath: string | null;
  ingestEpoch: number;
};

export type LinkedNotesSource = {
  exists: boolean;
  body: string;
};

export type IngestRetrySourceDecision =
  | { action: "use_storage" }
  | { action: "restore_text"; text: string }
  | { action: "reject"; error: string; notesLost: boolean };

export function ingestJobRowToRetryView(
  row: {
    status?: unknown;
    updated_at?: unknown;
    ingest_phase?: unknown;
    ingest_transcript?: unknown;
    source_format?: unknown;
    original_file_name?: unknown;
    storage_path?: unknown;
    ingest_epoch?: unknown;
  } | null
    | undefined
): IngestJobRetryView | null {
  if (!row) return null;
  return {
    status: typeof row.status === "string" ? row.status : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    ingestPhase:
      typeof row.ingest_phase === "string" ? row.ingest_phase : null,
    ingestTranscript:
      typeof row.ingest_transcript === "string" ? row.ingest_transcript : null,
    sourceFormat:
      typeof row.source_format === "string" ? row.source_format : null,
    originalFileName:
      typeof row.original_file_name === "string"
        ? row.original_file_name
        : null,
    storagePath:
      typeof row.storage_path === "string" ? row.storage_path : null,
    ingestEpoch:
      typeof row.ingest_epoch === "number" && Number.isFinite(row.ingest_epoch)
        ? row.ingest_epoch
        : 0,
  };
}

export function isTextIngestJob(job: {
  sourceFormat?: string | null;
  originalFileName?: string | null;
}): boolean {
  if (job.sourceFormat === "text") return true;
  return /\.txt$/i.test(job.originalFileName ?? "");
}

function ageMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return nowMs - t;
}

export function isReviewingTranscriptPhase(
  phase: string | null | undefined
): boolean {
  return phase === "reviewing_transcript";
}

/**
 * Persist `failed` when a job has made no progress for the long GET budget.
 * Transcript review is a user pause — do not fail it.
 */
export function shouldMarkIngestJobFailedAsStale(
  job: IngestJobRetryView,
  nowMs = Date.now()
): boolean {
  if (job.status !== "pending" && job.status !== "running") return false;
  if (isReviewingTranscriptPhase(job.ingestPhase)) return false;
  const budget = job.status === "pending" ? STALE_PENDING_MS : STALE_RUNNING_MS;
  const age = ageMs(job.updatedAt, nowMs);
  return age != null && age > budget;
}

/** Runner crashed / timed out: no heartbeat, but not yet in the long stale window. */
export function isDeadIngestWorker(
  job: IngestJobRetryView,
  nowMs = Date.now()
): boolean {
  if (job.status !== "pending" && job.status !== "running") return false;
  if (isReviewingTranscriptPhase(job.ingestPhase)) return false;
  const age = ageMs(job.updatedAt, nowMs);
  return age != null && age > DEAD_WORKER_MS;
}

/**
 * Redirect to this job instead of starting another conversion.
 * Failed, missing, and dead/stale workers are not reusable — caller should
 * create a new job (or reset this one) while the note still exists.
 */
export function shouldReuseExistingIngestJob(
  job: IngestJobRetryView | null,
  nowMs = Date.now()
): boolean {
  if (!job) return false;
  if (job.status === "complete") return true;
  if (job.status === "failed") return false;
  if (shouldMarkIngestJobFailedAsStale(job, nowMs)) return false;
  if (isDeadIngestWorker(job, nowMs)) return false;
  if (job.status === "pending" || job.status === "running") return true;
  return false;
}

/**
 * Decide how to restart a job whose storage object may have been deleted on
 * failure. `linkedNote.exists` is true only when the user_notes or live
 * lecture session row is still present.
 */
export function resolveIngestRetrySource(input: {
  storagePresent: boolean;
  job: Pick<
    IngestJobRetryView,
    "ingestTranscript" | "sourceFormat" | "originalFileName"
  >;
  linkedNote: LinkedNotesSource | null;
}): IngestRetrySourceDecision {
  if (input.storagePresent) return { action: "use_storage" };

  const transcript = input.job.ingestTranscript?.trim() ?? "";
  if (transcript.length >= NOTES_SOURCE_MIN_CHARS) {
    return { action: "restore_text", text: transcript };
  }

  const linked = input.linkedNote;
  if (linked?.exists) {
    const body = linked.body.trim();
    if (body.length >= NOTES_SOURCE_MIN_CHARS) {
      return { action: "restore_text", text: body };
    }
    if (body.length > 0) {
      return {
        action: "reject",
        error: NOTES_TOO_SHORT_ERROR,
        notesLost: false,
      };
    }
    return {
      action: "reject",
      error: NOTES_RESTORE_FAILED_ERROR,
      notesLost: false,
    };
  }

  if (isTextIngestJob(input.job)) {
    return { action: "reject", error: NOTES_LOST_ERROR, notesLost: true };
  }

  return { action: "reject", error: PDF_STORAGE_LOST_ERROR, notesLost: false };
}

/** Lost-notes copy is allowed only when the note/session row is gone. */
export function notesAreLostCopy(noteExists: boolean): string | null {
  return noteExists ? null : NOTES_LOST_ERROR;
}
