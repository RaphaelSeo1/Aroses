import {
  detectIngestFormat,
  MAX_INGEST_DOCUMENT_BYTES,
  MAX_INGEST_IMAGE_BYTES,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";

/** Document/image kinds chat can extract. Audio/video/zip stay out of chat context. */
export const CHAT_ATTACHMENT_KINDS = [
  "pdf",
  "word",
  "slides",
  "text",
  "markdown",
  "rtf",
  "image",
] as const;

export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

export const MAX_CHAT_ATTACHMENTS = 5;
/** Cap so a handout fits beside notes / lesson / calendar context. */
export const MAX_CHAT_ATTACHMENT_CHARS = 16_000;
export const MIN_CHAT_ATTACHMENT_CHARS = 12;

export const CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE =
  "This chat can use PDFs, Word, slides, images, and text files.";

export const CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE = [
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
  ".heif",
].join(",");

const CHAT_KIND_SET = new Set<string>(CHAT_ATTACHMENT_KINDS);

export function isChatAttachmentKind(
  kind: IngestFormatKind | null | undefined
): kind is ChatAttachmentKind {
  return Boolean(kind && CHAT_KIND_SET.has(kind));
}

export function maxBytesForChatKind(kind: ChatAttachmentKind): number {
  return kind === "image" ? MAX_INGEST_IMAGE_BYTES : MAX_INGEST_DOCUMENT_BYTES;
}

export function chatFileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function lookAtAttachmentPrompt(fileName: string): string {
  const name = fileName.trim();
  return name ? `Look at this file (${name}).` : "Look at this file.";
}

export type QueueChatAttachmentResult = {
  accepted: File[];
  nextQueued: File[];
  error: string | null;
};

/**
 * Filter picker / drop files for chat attach. Rejects audio, video, and
 * unknown types with a clear error — never silently ignores them.
 */
export function queueChatAttachmentFiles(input: {
  incoming: File[];
  alreadyQueued: File[];
  maxCount?: number;
}): QueueChatAttachmentResult {
  const maxCount = input.maxCount ?? MAX_CHAT_ATTACHMENTS;
  const alreadyQueued = input.alreadyQueued;
  const accepted: File[] = [];
  let skippedType = 0;
  let skippedMedia = 0;
  let skippedSize = 0;
  let maxSizeMb = Math.round(MAX_INGEST_DOCUMENT_BYTES / (1024 * 1024));

  for (const file of input.incoming) {
    const kind = detectIngestFormat(file.name, file.type);
    if (kind === "audio" || kind === "video") {
      skippedMedia += 1;
      continue;
    }
    if (!isChatAttachmentKind(kind)) {
      skippedType += 1;
      continue;
    }
    const cap = maxBytesForChatKind(kind);
    maxSizeMb = Math.max(maxSizeMb, Math.round(cap / (1024 * 1024)));
    if (file.size > cap) {
      skippedSize += 1;
      continue;
    }
    accepted.push(file);
  }

  const have = new Set(alreadyQueued.map(chatFileKey));
  const nextQueued = [...alreadyQueued];
  let overflow = false;
  for (const file of accepted) {
    if (nextQueued.length >= maxCount) {
      overflow = true;
      break;
    }
    const key = chatFileKey(file);
    if (have.has(key)) continue;
    have.add(key);
    nextQueued.push(file);
  }
  if (accepted.length + alreadyQueued.length > maxCount) overflow = true;

  const skippedUnsupported = skippedType + skippedMedia;
  let error: string | null = null;
  if (accepted.length === 0) {
    error =
      skippedSize > 0
        ? `That file is too large (max ${maxSizeMb}MB).`
        : CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE;
  } else if (overflow) {
    error = `You can attach up to ${maxCount} files at a time.`;
  } else if (skippedSize > 0) {
    error = `Skipped ${skippedSize} file${skippedSize === 1 ? "" : "s"} over ${maxSizeMb}MB.`;
  } else if (skippedUnsupported > 0) {
    error = CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE;
  }

  return { accepted, nextQueued, error };
}
