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

  for (let i = 0; i < refs.length; i++) {
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
    const part = await extractStudyMaterialFromBuffer({
      buffer: buf,
      fileName,
      kind,
      imageIndex,
      onHeartbeat: input.onHeartbeat,
    });
    extractedParts.push(part);

    const figures = await extractSourceImagesFromBuffer({
      buffer: buf,
      fileName,
      kind,
    });
    rawImages.push(...figures);

    if (part.meta.retainStorage || shouldRetainStorageAfterIngest(kind)) {
      retainStorage = true;
      if (kind === "audio" || kind === "video") {
        mediaMeta = {
          kind,
          bucket: STUDY_PDF_INGEST_BUCKET,
          storagePath: ref.storagePath,
          fileName,
          transcriptSegments: part.meta.transcript?.segments,
        };
      }
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
    skippedMiddle: false,
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
