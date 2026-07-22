import { NextResponse } from "next/server";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import {
  detectIngestFormat,
  formatLabel,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

type SourceFileOut = {
  jobId: string;
  fileName: string;
  kind: string;
  label: string;
  storagePath: string | null;
  /** Time-limited signed URL when the blob still exists in storage. */
  url: string | null;
  missing: boolean;
  retainStorage: boolean | null;
  status: string | null;
  /** Short transcript preview when the original file was not retained. */
  transcriptPreview: string | null;
};

type JobRow = {
  id: string;
  user_id: string;
  storage_path: string | null;
  original_file_name: string | null;
  source_format: string | null;
  source_files: unknown;
  retain_storage: boolean | null;
  ingest_transcript: string | null;
  status: string | null;
};

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

function asKind(raw: unknown): IngestFormatKind | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (INGEST_KINDS.has(t)) return t as IngestFormatKind;
  return detectIngestFormat(t);
}

function readPathFromRef(f: Record<string, unknown>): string | null {
  for (const key of ["storagePath", "storage_path", "path"] as const) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function readNameFromRef(
  f: Record<string, unknown>,
  fallbackPath: string
): string {
  for (const key of ["originalFileName", "original_file_name", "fileName"] as const) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return fallbackPath.split("/").pop() || "file";
}

function collectPaths(job: JobRow): Array<{
  storagePath: string;
  fileName: string;
  kind: IngestFormatKind | null;
}> {
  const out: Array<{
    storagePath: string;
    fileName: string;
    kind: IngestFormatKind | null;
  }> = [];
  const seen = new Set<string>();

  const push = (
    storagePath: string,
    fileName: string,
    kind: IngestFormatKind | null
  ) => {
    if (seen.has(storagePath)) return;
    seen.add(storagePath);
    out.push({ storagePath, fileName, kind });
  };

  if (Array.isArray(job.source_files)) {
    for (const item of job.source_files) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const path = readPathFromRef(f);
      if (!path) continue;
      const fileName = readNameFromRef(f, path);
      const kind =
        asKind(f.kind) ?? detectIngestFormat(fileName) ?? detectIngestFormat(path);
      push(path, fileName, kind);
    }
  }

  if (typeof job.storage_path === "string" && job.storage_path.trim()) {
    const path = job.storage_path.trim();
    const fileName =
      typeof job.original_file_name === "string" && job.original_file_name.trim()
        ? job.original_file_name.trim()
        : path.split("/").pop() || "file";
    const kind =
      asKind(job.source_format) ??
      detectIngestFormat(fileName) ??
      detectIngestFormat(path);
    push(path, fileName, kind);
  }

  return out;
}

async function signedUrlForPath(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  storagePath: string
): Promise<{ url: string | null; missing: boolean }> {
  const slash = storagePath.lastIndexOf("/");
  const folder = slash >= 0 ? storagePath.slice(0, slash) : "";
  const objectName = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;

  const { data: listed, error: listErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .list(folder, { search: objectName, limit: 20 });

  const exists =
    !listErr &&
    Array.isArray(listed) &&
    listed.some((o) => o.name === objectName);

  if (!exists) {
    if (listErr) {
      console.warn("[admin] source list failed", storagePath, listErr.message);
    }
    return { url: null, missing: true };
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  if (!signErr && signed?.signedUrl) {
    return { url: signed.signedUrl, missing: false };
  }

  console.warn("[admin] signed url failed", storagePath, signErr?.message);
  return { url: null, missing: true };
}

/**
 * GET — admin-only list of course upload sources with signed view URLs.
 * Uploads are retained after ingest so PDFs (and other sources) stay openable.
 */
export async function GET(_request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAppAdminEnvUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 503 });
  }

  const { data: course, error: courseErr } = await admin
    .from("courses")
    .select("id, title, user_id")
    .eq("id", courseId)
    .maybeSingle();

  if (courseErr || !course) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  const { data: jobs, error: jobsErr } = await admin
    .from("pdf_ingest_jobs")
    .select(
      "id, user_id, storage_path, original_file_name, source_format, source_files, retain_storage, ingest_transcript, status"
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (jobsErr) {
    console.error("[admin] course sources", jobsErr);
    return NextResponse.json({ error: "Could not load sources." }, { status: 500 });
  }

  const files: SourceFileOut[] = [];

  for (const raw of jobs ?? []) {
    const job = raw as JobRow;
    const paths = collectPaths(job);
    const transcript =
      typeof job.ingest_transcript === "string" && job.ingest_transcript.trim()
        ? job.ingest_transcript.trim().slice(0, 400)
        : null;

    if (paths.length === 0) {
      files.push({
        jobId: job.id,
        fileName: job.original_file_name?.trim() || "Text / link source",
        kind: job.source_format ?? "text",
        label: formatLabel(
          (asKind(job.source_format) ?? "text") as IngestFormatKind
        ),
        storagePath: null,
        url: null,
        missing: true,
        retainStorage: job.retain_storage,
        status: job.status,
        transcriptPreview: transcript,
      });
      continue;
    }

    for (const ref of paths) {
      const { url, missing } = await signedUrlForPath(admin, ref.storagePath);
      files.push({
        jobId: job.id,
        fileName: ref.fileName,
        kind: ref.kind ?? "unknown",
        label: ref.kind ? formatLabel(ref.kind) : "File",
        storagePath: ref.storagePath,
        url,
        missing,
        retainStorage: job.retain_storage,
        status: job.status,
        transcriptPreview: missing ? transcript : null,
      });
    }
  }

  return NextResponse.json({
    courseId: course.id,
    title: course.title,
    ownerUserId: course.user_id,
    files,
  });
}
