import assert from "node:assert/strict";
import test from "node:test";
import {
  DEAD_WORKER_MS,
  NOTES_LOST_ERROR,
  NOTES_RESTORE_FAILED_ERROR,
  NOTES_TOO_SHORT_ERROR,
  PDF_STORAGE_LOST_ERROR,
  STALE_RUNNING_MS,
  ingestJobRowToRetryView,
  isDeadIngestWorker,
  notesAreLostCopy,
  resolveIngestRetrySource,
  shouldMarkIngestJobFailedAsStale,
  shouldReuseExistingIngestJob,
  type IngestJobRetryView,
} from "./ingest-job-retry.ts";

function job(
  overrides: Partial<IngestJobRetryView> = {}
): IngestJobRetryView {
  return {
    status: "running",
    updatedAt: new Date().toISOString(),
    ingestPhase: "digesting_full_pdf",
    ingestTranscript: null,
    sourceFormat: "text",
    originalFileName: "Lecture notes.txt",
    storagePath: "user/job.txt",
    ingestEpoch: 0,
    ...overrides,
  };
}

const NOTE_BODY =
  "Scarcity means resources are limited. Opportunity cost is the next-best option you give up when you choose. Trade-offs show up in every production decision.";

test("retry is allowed when the note exists and the job failed", () => {
  const failed = job({ status: "failed", ingestPhase: null });
  assert.equal(shouldReuseExistingIngestJob(failed), false);
  const decision = resolveIngestRetrySource({
    storagePresent: false,
    job: failed,
    linkedNote: { exists: true, body: NOTE_BODY },
  });
  assert.deepEqual(decision, { action: "restore_text", text: NOTE_BODY });
  assert.equal(notesAreLostCopy(true), null);
});

test("retry is allowed when the note exists and the job is a dead in-progress worker", () => {
  const now = Date.parse("2026-09-10T19:00:00.000Z");
  const stale = job({
    status: "running",
    ingestPhase: "digesting_full_pdf",
    updatedAt: new Date(now - DEAD_WORKER_MS - 1_000).toISOString(),
  });
  assert.equal(isDeadIngestWorker(stale, now), true);
  assert.equal(shouldReuseExistingIngestJob(stale, now), false);
  const decision = resolveIngestRetrySource({
    storagePresent: false,
    job: { ...stale, ingestTranscript: `[from notes]\n${NOTE_BODY}` },
    linkedNote: { exists: true, body: NOTE_BODY },
  });
  assert.equal(decision.action, "restore_text");
  assert.equal(notesAreLostCopy(true), null);
});

test("lost-notes copy is returned only when the note row is missing", () => {
  assert.equal(notesAreLostCopy(false), NOTES_LOST_ERROR);
  assert.equal(notesAreLostCopy(true), null);

  const missingNote = resolveIngestRetrySource({
    storagePresent: false,
    job: job({ ingestTranscript: null }),
    linkedNote: null,
  });
  assert.deepEqual(missingNote, {
    action: "reject",
    error: NOTES_LOST_ERROR,
    notesLost: true,
  });

  const presentNote = resolveIngestRetrySource({
    storagePresent: false,
    job: job({ ingestTranscript: null }),
    linkedNote: { exists: true, body: NOTE_BODY },
  });
  assert.equal(presentNote.action, "restore_text");
  if (presentNote.action === "restore_text") {
    assert.equal(presentNote.text, NOTE_BODY);
  }
});

test("never claims notes are lost when the note is present even if storage and transcript are gone", () => {
  const short = resolveIngestRetrySource({
    storagePresent: false,
    job: job({ ingestTranscript: "   " }),
    linkedNote: { exists: true, body: "Too short." },
  });
  assert.deepEqual(short, {
    action: "reject",
    error: NOTES_TOO_SHORT_ERROR,
    notesLost: false,
  });

  const empty = resolveIngestRetrySource({
    storagePresent: false,
    job: job({ ingestTranscript: null }),
    linkedNote: { exists: true, body: "" },
  });
  assert.deepEqual(empty, {
    action: "reject",
    error: NOTES_RESTORE_FAILED_ERROR,
    notesLost: false,
  });
});

test("reuse a healthy in-progress or complete job, but not a failed one", () => {
  assert.equal(shouldReuseExistingIngestJob(job({ status: "complete" })), true);
  assert.equal(
    shouldReuseExistingIngestJob(
      job({ status: "running", ingestPhase: "reviewing_transcript" })
    ),
    true
  );
  assert.equal(shouldReuseExistingIngestJob(job({ status: "pending" })), true);
  assert.equal(shouldReuseExistingIngestJob(job({ status: "failed" })), false);
  assert.equal(shouldReuseExistingIngestJob(null), false);
});

test("transcript review is not marked stale even after a long pause", () => {
  const now = Date.parse("2026-09-10T19:00:00.000Z");
  const reviewing = job({
    status: "running",
    ingestPhase: "reviewing_transcript",
    updatedAt: new Date(now - STALE_RUNNING_MS - 60_000).toISOString(),
  });
  assert.equal(shouldMarkIngestJobFailedAsStale(reviewing, now), false);
  assert.equal(isDeadIngestWorker(reviewing, now), false);
  assert.equal(shouldReuseExistingIngestJob(reviewing, now), true);
});

test("long-stale running jobs (not review) are marked failed", () => {
  const now = Date.parse("2026-09-10T19:00:00.000Z");
  const stuck = job({
    status: "running",
    ingestPhase: "planning_outline",
    updatedAt: new Date(now - STALE_RUNNING_MS - 1).toISOString(),
  });
  assert.equal(shouldMarkIngestJobFailedAsStale(stuck, now), true);
  assert.equal(shouldReuseExistingIngestJob(stuck, now), false);
});

test("PDF jobs without a linked note use the storage-lost message, not notes-lost", () => {
  const decision = resolveIngestRetrySource({
    storagePresent: false,
    job: {
      ingestTranscript: null,
      sourceFormat: "pdf",
      originalFileName: "slides.pdf",
    },
    linkedNote: null,
  });
  assert.deepEqual(decision, {
    action: "reject",
    error: PDF_STORAGE_LOST_ERROR,
    notesLost: false,
  });
});

test("storage still present is always enough to retry", () => {
  const decision = resolveIngestRetrySource({
    storagePresent: true,
    job: job({ ingestTranscript: null }),
    linkedNote: null,
  });
  assert.deepEqual(decision, { action: "use_storage" });
});

test("ingestJobRowToRetryView maps a failed notes job row", () => {
  const view = ingestJobRowToRetryView({
    status: "failed",
    updated_at: "2026-09-10T12:00:00.000Z",
    ingest_phase: null,
    ingest_transcript: NOTE_BODY,
    source_format: "text",
    original_file_name: "Notes.txt",
    storage_path: "u/a.txt",
    ingest_epoch: 2,
  });
  assert.equal(view?.status, "failed");
  assert.equal(view?.ingestTranscript, NOTE_BODY);
  assert.equal(shouldReuseExistingIngestJob(view), false);
});
