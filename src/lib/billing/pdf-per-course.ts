/**
 * Cumulative PDF-per-course structural cap (not per-upload-request).
 * Removing an active source may lower this count; it never refunds source pages.
 */

import { detectIngestFormat } from "../study-ingest/formats.ts";

export const PDF_PER_COURSE_CAP_CODE = "pdf_per_course_cap_reached";

const ACTIVE_JOB_STATUSES = new Set([
  "pending",
  "running",
  "complete",
  "reviewing_transcript",
  "awaiting_confirm",
  "expanding",
]);

export function isPdfFileName(name: string | null | undefined): boolean {
  if (!name) return false;
  return detectIngestFormat(name) === "pdf";
}

export function countPdfNames(names: Array<string | null | undefined>): number {
  return names.filter((n) => isPdfFileName(n)).length;
}

type SourceFileLike = {
  originalFileName?: string | null;
  storagePath?: string | null;
  kind?: string | null;
};

export function countPdfsInSourceFiles(sourceFiles: unknown): number {
  if (!Array.isArray(sourceFiles)) return 0;
  let n = 0;
  for (const item of sourceFiles) {
    if (!item || typeof item !== "object") continue;
    const f = item as SourceFileLike;
    if (f.kind === "pdf") {
      n += 1;
      continue;
    }
    const name = f.originalFileName || f.storagePath || "";
    if (isPdfFileName(name)) n += 1;
  }
  return n;
}

export type IngestJobPdfRow = {
  status?: string | null;
  source_format?: string | null;
  original_file_name?: string | null;
  storage_path?: string | null;
  source_files?: unknown;
};

export function jobCountsTowardPdfCap(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  if (!s) return true;
  if (s === "failed" || s === "canceled" || s === "cancelled") return false;
  return ACTIVE_JOB_STATUSES.has(s) || s === "complete" || s === "pending" || s === "running";
}

export function pdfCountForJob(job: IngestJobPdfRow): number {
  if (!jobCountsTowardPdfCap(job.status)) return 0;
  const fromFiles = countPdfsInSourceFiles(job.source_files);
  if (fromFiles > 0) return fromFiles;
  if (job.source_format === "pdf") return 1;
  if (isPdfFileName(job.original_file_name) || isPdfFileName(job.storage_path)) {
    return 1;
  }
  return 0;
}

export function sumActivePdfsForCourse(jobs: IngestJobPdfRow[]): number {
  return jobs.reduce((sum, job) => sum + pdfCountForJob(job), 0);
}

export function pdfCapWouldExceed(opts: {
  activePdfs: number;
  incomingPdfs: number;
  cap: number;
}): boolean {
  return opts.activePdfs + opts.incomingPdfs > opts.cap;
}
