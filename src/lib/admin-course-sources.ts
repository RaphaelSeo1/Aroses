import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatLabel,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";

const INGEST_KINDS = new Set<string>([
  "pdf",
  "word",
  "slides",
  "text",
  "markdown",
  "rtf",
  "image",
  "audio",
  "video",
]);

export type AdminCourseMaterial = {
  /** Human label: PDF, Image, Link, Live lecture, … */
  label: string;
  /** Original upload / job file name when available. */
  fileName: string | null;
  /** Machine kind used for sorting/dedupe. */
  kindKey: string;
};

export type AdminCourseSources = {
  /** Unique labels for chips, stable order. */
  labels: string[];
  /** Per-job / per-file rows for tooltips / detail. */
  materials: AdminCourseMaterial[];
};

const LABEL_ORDER = [
  "PDF",
  "Word",
  "Slides",
  "Image",
  "Audio",
  "Video",
  "Markdown",
  "RTF",
  "Link",
  "Notes",
  "Live lecture",
  "Text",
];

function asIngestKind(raw: unknown): IngestFormatKind | null {
  if (typeof raw !== "string") return null;
  return INGEST_KINDS.has(raw) ? (raw as IngestFormatKind) : null;
}

function textSubtypeLabel(
  transcript: string | null | undefined,
  isLiveLecture: boolean
): string {
  if (isLiveLecture) return "Live lecture";
  const head = (transcript ?? "").slice(0, 240);
  if (/^\[from link:/i.test(head)) return "Link";
  if (/^\[from .+ notes\]/i.test(head)) return "Notes";
  if (/^\[from .+ transcript\]/i.test(head)) return "Live lecture";
  return "Text";
}

function labelForKind(
  kind: IngestFormatKind,
  transcript: string | null | undefined,
  isLiveLecture: boolean
): string {
  if (kind === "text") return textSubtypeLabel(transcript, isLiveLecture);
  return formatLabel(kind);
}

function collectKindsFromJob(job: {
  source_format: string | null;
  source_files: unknown;
}): IngestFormatKind[] {
  const kinds: IngestFormatKind[] = [];
  const primary = asIngestKind(job.source_format);
  if (primary) kinds.push(primary);
  if (Array.isArray(job.source_files)) {
    for (const f of job.source_files) {
      if (!f || typeof f !== "object") continue;
      const k = asIngestKind((f as { kind?: unknown }).kind);
      if (k) kinds.push(k);
    }
  }
  return kinds.length > 0 ? kinds : primary ? [primary] : [];
}

function fileNamesFromJob(job: {
  original_file_name: string | null;
  source_files: unknown;
}): string[] {
  const names: string[] = [];
  if (Array.isArray(job.source_files)) {
    for (const f of job.source_files) {
      if (!f || typeof f !== "object") continue;
      const n = (f as { originalFileName?: unknown }).originalFileName;
      if (typeof n === "string" && n.trim()) names.push(n.trim());
    }
  }
  if (
    names.length === 0 &&
    typeof job.original_file_name === "string" &&
    job.original_file_name.trim()
  ) {
    names.push(job.original_file_name.trim());
  }
  return names;
}

function sortLabels(labels: Iterable<string>): string[] {
  const set = new Set(labels);
  const ordered = LABEL_ORDER.filter((l) => set.has(l));
  for (const l of set) {
    if (!ordered.includes(l)) ordered.push(l);
  }
  return ordered;
}

/**
 * Load upload / ingest source kinds for admin course list (PDF, image, link…).
 */
export async function loadAdminCourseSources(
  admin: SupabaseClient,
  courseIds: string[]
): Promise<Map<string, AdminCourseSources>> {
  const out = new Map<string, AdminCourseSources>();
  if (courseIds.length === 0) return out;

  const empty = (): AdminCourseSources => ({ labels: [], materials: [] });

  const [jobsRes, liveRes] = await Promise.all([
    admin
      .from("pdf_ingest_jobs")
      .select(
        "id, course_id, source_format, source_files, original_file_name, ingest_transcript, status"
      )
      .in("course_id", courseIds)
      .limit(5_000),
    admin
      .from("live_lecture_sessions")
      .select("course_id, ingest_job_id")
      .in("course_id", courseIds)
      .not("ingest_job_id", "is", null)
      .limit(2_000),
  ]);

  const liveJobIds = new Set<string>();
  for (const row of liveRes.data ?? []) {
    if (typeof row.ingest_job_id === "string") {
      liveJobIds.add(row.ingest_job_id);
    }
  }

  type Acc = {
    labels: Set<string>;
    materials: AdminCourseMaterial[];
  };
  const byCourse = new Map<string, Acc>();

  for (const id of courseIds) {
    byCourse.set(id, { labels: new Set(), materials: [] });
  }

  if (jobsRes.error) {
    console.error("[admin] course sources", jobsRes.error);
    // Graceful: older DBs without source_format — leave empty.
    for (const id of courseIds) out.set(id, empty());
    return out;
  }

  for (const job of jobsRes.data ?? []) {
    const courseId = job.course_id as string | null;
    if (!courseId || !byCourse.has(courseId)) continue;
    const acc = byCourse.get(courseId)!;
    const isLive = liveJobIds.has(job.id as string);
    const transcript =
      typeof job.ingest_transcript === "string" ? job.ingest_transcript : null;
    const kinds = collectKindsFromJob({
      source_format:
        typeof job.source_format === "string" ? job.source_format : null,
      source_files: job.source_files,
    });
    const files = fileNamesFromJob({
      original_file_name:
        typeof job.original_file_name === "string"
          ? job.original_file_name
          : null,
      source_files: job.source_files,
    });

    if (kinds.length === 0) {
      const label = textSubtypeLabel(transcript, isLive);
      acc.labels.add(label);
      acc.materials.push({
        label,
        fileName: files[0] ?? null,
        kindKey: label.toLowerCase(),
      });
      continue;
    }

    // Multi-file batches: one material row per file when possible.
    if (Array.isArray(job.source_files) && job.source_files.length > 0) {
      for (const f of job.source_files) {
        if (!f || typeof f !== "object") continue;
        const kind =
          asIngestKind((f as { kind?: unknown }).kind) ?? kinds[0] ?? "text";
        const label = labelForKind(kind, transcript, isLive);
        const fileName =
          typeof (f as { originalFileName?: unknown }).originalFileName ===
          "string"
            ? String(
                (f as { originalFileName: string }).originalFileName
              ).trim() || null
            : null;
        acc.labels.add(label);
        acc.materials.push({
          label,
          fileName,
          kindKey: `${kind}:${fileName ?? ""}`,
        });
      }
    } else {
      for (const kind of kinds) {
        const label = labelForKind(kind, transcript, isLive);
        acc.labels.add(label);
        acc.materials.push({
          label,
          fileName: files[0] ?? null,
          kindKey: kind,
        });
      }
    }
  }

  for (const [courseId, acc] of byCourse) {
    out.set(courseId, {
      labels: sortLabels(acc.labels),
      materials: acc.materials,
    });
  }
  return out;
}
