import {
  detectIngestFormat,
  formatLabel,
  MAX_INGEST_AUDIO_BYTES,
  MAX_INGEST_BATCH_TOTAL_BYTES,
  MAX_INGEST_DOCUMENT_BYTES,
  MAX_INGEST_FILES_PER_BATCH,
  MAX_INGEST_IMAGES_PER_BATCH,
  MAX_INGEST_IMAGE_BYTES,
  MAX_INGEST_VIDEO_BYTES,
  maxBytesForKind,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";

export type IngestFileDescriptor = {
  fileName: string;
  sizeBytes: number;
  kind: IngestFormatKind;
};

export function describeIngestFile(file: File): IngestFileDescriptor | null {
  const kind = detectIngestFormat(file.name, file.type);
  if (!kind) return null;
  return { fileName: file.name, sizeBytes: file.size, kind };
}

export function validateIngestBatch(
  files: IngestFileDescriptor[]
): string | null {
  if (files.length === 0) {
    return "Choose or drop at least one file.";
  }
  if (files.length > MAX_INGEST_FILES_PER_BATCH) {
    return `You can upload up to ${MAX_INGEST_FILES_PER_BATCH} files per course (you selected ${files.length}).`;
  }

  const imageCount = files.filter((f) => f.kind === "image").length;
  if (imageCount > MAX_INGEST_IMAGES_PER_BATCH) {
    return `Too many images (${imageCount}). Maximum is ${MAX_INGEST_IMAGES_PER_BATCH} per upload.`;
  }

  let total = 0;
  for (const f of files) {
    const max = maxBytesForKind(f.kind);
    total += f.sizeBytes;
    if (f.sizeBytes > max) {
      const maxMb = Math.round(max / (1024 * 1024));
      const gotMb = Math.round(f.sizeBytes / (1024 * 1024));
      const hint =
        f.kind === "video"
          ? " Try compressing it or trimming it, or upload just the audio track."
          : f.kind === "audio"
            ? " Try a shorter clip or a lower bitrate export."
            : "";
      return `${f.fileName} is too large (${gotMb}MB). The maximum for ${formatLabel(f.kind).toLowerCase()} files is ${maxMb}MB.${hint}`;
    }
  }

  if (total > MAX_INGEST_BATCH_TOTAL_BYTES) {
    const maxGb = (MAX_INGEST_BATCH_TOTAL_BYTES / (1024 * 1024 * 1024)).toFixed(1);
    const gotMb = Math.round(total / (1024 * 1024));
    return `Total upload size is too large (${gotMb}MB). Combined limit is ${maxGb}GB per course.`;
  }

  return null;
}

export const INGEST_SIZE_HINT =
  "50MB for documents · 100MB for audio · 500MB for videos · 20MB per image";

export const INGEST_LIMITS_DOC = {
  document: MAX_INGEST_DOCUMENT_BYTES,
  audio: MAX_INGEST_AUDIO_BYTES,
  video: MAX_INGEST_VIDEO_BYTES,
  image: MAX_INGEST_IMAGE_BYTES,
};
