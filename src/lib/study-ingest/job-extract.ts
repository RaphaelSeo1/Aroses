import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectIngestFormat,
  maxBytesForKind,
  shouldRetainStorageAfterIngest,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";
import { combineExtractedSources } from "@/lib/study-ingest/combine";
import { extractStudyMaterialFromBuffer } from "@/lib/study-ingest/extract";
import { buildIngestChunks, type IngestChunk } from "@/lib/study-ingest/chunking";
import { extractSourceImagesFromBuffer } from "@/lib/study-ingest/source-images/extract-from-buffer";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import { uploadIngestSourceImages } from "@/lib/study-ingest/source-images/upload";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

const DL_DELAYS_MS = [1_500, 3_000, 6_000];

export type IngestSourceFileRef = {
  storagePath: string;
  originalFileName: string | null;
  kind?: IngestFormatKind | null;
};

export type JobExtractSuccess = {
  text: string;
  numpages: number;
  skippedMiddle: boolean;
  retainStorage: boolean;
  ingestMedia: {
    kind: "audio" | "video";
    bucket: string;
    storagePath: string;
    fileName: string;
    transcriptSegments?: Array<{ startSec: number; endSec: number; text: string }>;
  } | null;
  sourcePaths: string[];
  sourceImages: IngestSourceImageRecord[];
  /** Natural-boundary chunks across all files (for content-driven structure planning). */
  chunks: IngestChunk[];
};

function formatBytesLimit(kind: IngestFormatKind, bytes: number): string {
  const maxMb = Math.round(maxBytesForKind(kind) / (1024 * 1024));
  const gotMb = Math.round(bytes / (1024 * 1024));
  return `File is too large (${gotMb}MB). Maximum is ${maxMb}MB for this type.`;
}

async function downloadIngestObject(
  admin: SupabaseClient,
  storagePath: string,
  onHeartbeat?: () => void
): Promise<Buffer> {
  for (let attempt = 0; attempt <= DL_DELAYS_MS.length; attempt++) {
    onHeartbeat?.();
    const { data: blob, error: dlErr } = await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .download(storagePath);

    if (!dlErr && blob) {
      return Buffer.from(await blob.arrayBuffer());
    }
    if (attempt < DL_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, DL_DELAYS_MS[attempt]));
    } else {
      throw new Error(
        "Could not read the uploaded file from storage. Try uploading again."
      );
    }
  }
  throw new Error("Could not read the uploaded file from storage.");
}

export async function extractContentForIngestJob(input: {
  admin: SupabaseClient;
  jobId: string;
  userId: string;
  primaryStoragePath: string;
  primaryFileName: string | null;
  sourceFiles: IngestSourceFileRef[] | null;
  onHeartbeat?: () => void;
  onPhase?: (phase: "transcribing") => void;
}): Promise<JobExtractSuccess> {
  const refs: IngestSourceFileRef[] =
    input.sourceFiles && input.sourceFiles.length > 0
      ? input.sourceFiles
      : [
          {
            storagePath: input.primaryStoragePath,
            originalFileName: input.primaryFileName,
          },
        ];

  const extractedParts = [];
  const rawImages = [];
  let retainStorage = false;
  let mediaMeta: JobExtractSuccess["ingestMedia"] = null;

  // Extract files concurrently (bounded) so a big stack — e.g. a dozen photos,
  // each needing its own vision call — doesn't run serially and blow past the
  // serverless wall-clock (which leaves the job wedged on "step 1/2"). Order is
  // preserved so chunking/attribution still follows the upload order.
  type PerFileResult = {
    part: Awaited<ReturnType<typeof extractStudyMaterialFromBuffer>>;
    figures: Awaited<ReturnType<typeof extractSourceImagesFromBuffer>>;
    retain: boolean;
    media: JobExtractSuccess["ingestMedia"];
  };

  async function extractOne(i: number): Promise<PerFileResult> {
    const ref = refs[i];
    const fileName =
      ref.originalFileName?.trim() ||
      ref.storagePath.split("/").pop() ||
      "upload";
    const kind =
      ref.kind ?? detectIngestFormat(fileName) ?? detectIngestFormat(ref.storagePath);
    if (!kind) {
      throw new Error(
        `${fileName}: unsupported format. Try PDF, Word, slides, text, images, audio, or video.`
      );
    }

    const buf = await downloadIngestObject(
      input.admin,
      ref.storagePath,
      input.onHeartbeat
    );

    if (buf.length > maxBytesForKind(kind)) {
      throw new Error(`${fileName}: ${formatBytesLimit(kind, buf.length)}`);
    }

    const imageIndex = kind === "image" ? i : undefined;
    if (kind === "audio" || kind === "video") {
      input.onPhase?.("transcribing");
    }
    const embeddedImagesEnabled = (() => {
      const raw = process.env.PDF_INGEST_EMBEDDED_IMAGES?.trim();
      if (raw === "1" || raw?.toLowerCase() === "true") return true;
      if (raw === "0" || raw?.toLowerCase() === "false") return false;
      // Default off: a second full PDF pass is slow on long decks; page renders
      // are added later from the structure plan when needed.
      return kind !== "pdf";
    })();

    const [part, figures] = await Promise.all([
      extractStudyMaterialFromBuffer({
        buffer: buf,
        fileName,
        kind,
        imageIndex,
        onHeartbeat: input.onHeartbeat,
      }),
      embeddedImagesEnabled
        ? extractSourceImagesFromBuffer({ buffer: buf, fileName, kind })
        : Promise.resolve([]),
    ]);

    let retain = false;
    let media: JobExtractSuccess["ingestMedia"] = null;
    if (part.meta.retainStorage || shouldRetainStorageAfterIngest(kind)) {
      retain = true;
      if (kind === "audio" || kind === "video") {
        media = {
          kind,
          bucket: STUDY_PDF_INGEST_BUCKET,
          storagePath: ref.storagePath,
          fileName,
          transcriptSegments: part.meta.transcript?.segments,
        };
      }
    }
    return { part, figures, retain, media };
  }

  const concurrencyEnv = process.env.PDF_INGEST_EXTRACT_CONCURRENCY?.trim();
  const concurrencyParsed = concurrencyEnv
    ? Number.parseInt(concurrencyEnv, 10)
    : Number.NaN;
  const EXTRACT_CONCURRENCY = Number.isFinite(concurrencyParsed)
    ? Math.max(1, Math.min(8, concurrencyParsed))
    : 4;

  const results: (PerFileResult | undefined)[] = new Array(refs.length);
  let cursor = 0;
  async function pump(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= refs.length) return;
      results[i] = await extractOne(i);
    }
  }
  // First rejection (e.g. an unreadable image) propagates and fails the job,
  // matching the previous serial behaviour.
  await Promise.all(
    Array.from({ length: Math.min(EXTRACT_CONCURRENCY, refs.length) }, () =>
      pump()
    )
  );

  for (let i = 0; i < refs.length; i++) {
    const r = results[i];
    if (!r) continue;
    extractedParts.push(r.part);
    rawImages.push(...r.figures);
    if (r.retain) {
      retainStorage = true;
      if (r.media) mediaMeta = r.media;
    }
  }

  const { plainText, retainStorage: combinedRetain } =
    combineExtractedSources(extractedParts);
  if (combinedRetain) retainStorage = true;

  let textForCourse = plainText;
  if (textForCourse.length < 80) {
    if (rawImages.length === 0) {
      throw new Error(
        "Not enough content extracted from these files. Try materials with more text or a clearer recording."
      );
    }
    const figureSummary = rawImages
      .map(
        (img) =>
          `[Figure: ${img.label}${img.anchorType === "slide" ? ` (slide ${img.anchorIndex})` : img.anchorType === "page" ? ` (page ${img.anchorIndex})` : ""}]`
      )
      .join("\n");
    textForCourse = [plainText.trim(), figureSummary]
      .filter((s) => s.length > 0)
      .join("\n\n");
  }

  const pdfMeta = extractedParts.find((p) => p.meta.kind === "pdf")?.meta;
  const skippedMiddle = extractedParts.some(
    (p) => p.meta.kind === "pdf" && p.meta.skippedMiddle === true
  );

  const chunks = buildIngestChunks(extractedParts);

  const sourceImages = await uploadIngestSourceImages({
    admin: input.admin,
    userId: input.userId,
    jobId: input.jobId,
    images: rawImages,
  });

  return {
    text: textForCourse,
    chunks,
    numpages: pdfMeta?.pageCount ?? 0,
    skippedMiddle,
    retainStorage,
    ingestMedia: mediaMeta,
    sourcePaths: refs.map((r) => r.storagePath),
    sourceImages,
  };
}

export async function removeIngestObjects(
  admin: SupabaseClient,
  paths: string[],
  retainStorage: boolean
): Promise<void> {
  if (retainStorage) return;
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  await admin.storage.from(STUDY_PDF_INGEST_BUCKET).remove(unique).catch(() => {});
}
