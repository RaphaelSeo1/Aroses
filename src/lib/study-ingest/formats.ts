/**
 * Supported study-material ingest formats for course generation.
 * PDF behavior is unchanged; other types normalize to plain text + attribution
 * before the existing outline/module pipeline runs.
 */

export type IngestFormatKind =
  | "pdf"
  | "word"
  | "slides"
  | "text"
  | "markdown"
  | "rtf"
  | "image"
  | "audio"
  | "video";

export const MAX_INGEST_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_INGEST_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_INGEST_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_INGEST_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_INGEST_FILES_PER_BATCH = 10;
export const MAX_INGEST_BATCH_TOTAL_BYTES = 1024 * 1024 * 1024;
export const MAX_INGEST_IMAGES_PER_BATCH = 50;

/** Whisper API hard limit — larger media needs compression or audio-only upload. */
export const MAX_WHISPER_BYTES = 25 * 1024 * 1024;

const EXT_TO_KIND: Record<string, IngestFormatKind> = {
  pdf: "pdf",
  docx: "word",
  doc: "word",
  pptx: "slides",
  ppt: "slides",
  txt: "text",
  md: "markdown",
  markdown: "markdown",
  rtf: "rtf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  heif: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  avi: "video",
};

export function extensionOfFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function detectIngestFormat(
  fileName: string,
  mimeType?: string
): IngestFormatKind | null {
  const ext = extensionOfFileName(fileName);
  if (ext && EXT_TO_KIND[ext]) return EXT_TO_KIND[ext];

  const m = (mimeType ?? "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (
    m.includes("wordprocessingml") ||
    m === "application/msword"
  ) {
    return "word";
  }
  if (m.includes("presentationml") || m === "application/vnd.ms-powerpoint") {
    return "slides";
  }
  if (m.startsWith("text/plain")) return "text";
  if (m.startsWith("text/markdown")) return "markdown";
  if (m === "application/rtf" || m === "text/rtf") return "rtf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return null;
}

export function maxBytesForKind(kind: IngestFormatKind): number {
  switch (kind) {
    case "audio":
      return MAX_INGEST_AUDIO_BYTES;
    case "video":
      return MAX_INGEST_VIDEO_BYTES;
    case "image":
      return MAX_INGEST_IMAGE_BYTES;
    default:
      return MAX_INGEST_DOCUMENT_BYTES;
  }
}

export function storageExtensionForKind(kind: IngestFormatKind): string {
  switch (kind) {
    case "pdf":
      return "pdf";
    case "word":
      return "docx";
    case "slides":
      return "pptx";
    case "text":
      return "txt";
    case "markdown":
      return "md";
    case "rtf":
      return "rtf";
    case "image":
      return "png";
    case "audio":
      return "mp3";
    case "video":
      return "mp4";
  }
}

export function contentTypeForUpload(
  fileName: string,
  kind: IngestFormatKind
): string {
  const ext = extensionOfFileName(fileName);
  if (kind === "pdf") return "application/pdf";
  if (kind === "word") {
    return ext === "doc"
      ? "application/msword"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (kind === "slides") {
    return ext === "ppt"
      ? "application/vnd.ms-powerpoint"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (kind === "markdown") return "text/markdown";
  if (kind === "text") return "text/plain";
  if (kind === "rtf") return "application/rtf";
  if (kind === "image") {
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    if (ext === "heic" || ext === "heif") return "image/heic";
    return "image/jpeg";
  }
  if (kind === "audio") {
    if (ext === "wav") return "audio/wav";
    if (ext === "m4a") return "audio/mp4";
    if (ext === "ogg") return "audio/ogg";
    return "audio/mpeg";
  }
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "avi") return "video/x-msvideo";
  return "video/mp4";
}

export function shouldRetainStorageAfterIngest(kind: IngestFormatKind): boolean {
  return kind === "video" || kind === "audio";
}

export const INGEST_ACCEPT_ATTRIBUTE = [
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".txt",
  ".md",
  ".markdown",
  ".rtf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".mp4",
  ".mov",
  ".webm",
  ".avi",
].join(",");

export const INGEST_ACCEPT_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/markdown",
  "application/rtf",
  "text/rtf",
  "image/*",
  "audio/*",
  "video/*",
].join(",");

export function formatLabel(kind: IngestFormatKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "word":
      return "Word";
    case "slides":
      return "Slides";
    case "text":
      return "Text";
    case "markdown":
      return "Markdown";
    case "rtf":
      return "RTF";
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
  }
}

export function estimatedProcessingHint(kind: IngestFormatKind): string {
  switch (kind) {
    case "pdf":
      return "About 30 seconds";
    case "word":
    case "slides":
    case "text":
    case "markdown":
    case "rtf":
      return "About 30–60 seconds";
    case "image":
      return "About 1–2 minutes";
    case "audio":
      return "About 3–5 minutes";
    case "video":
      return "About 5–10 minutes";
  }
}
