import {
  detectIngestFormat,
  extensionOfFileName,
  storageExtensionForKind,
} from "@/lib/study-ingest/formats";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_EXT = new Set([
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "txt",
  "md",
  "markdown",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "mp4",
  "mov",
  "webm",
  "avi",
]);

/** `{userId}/{uuid}.{ext}` — any supported ingest extension. */
export const INGEST_OBJECT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i;

export function isValidIngestStoragePath(
  storagePath: string,
  userId: string
): boolean {
  const prefix = `${userId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  if (storagePath.includes("..") || storagePath.includes("\\")) return false;
  const objectKey = storagePath.slice(prefix.length);
  if (!INGEST_OBJECT_RE.test(objectKey)) return false;
  const ext = extensionOfFileName(objectKey);
  return ALLOWED_EXT.has(ext);
}

export function buildIngestStoragePath(
  userId: string,
  fileName: string
): string | null {
  const kind = detectIngestFormat(fileName);
  if (!kind) return null;
  const ext =
    extensionOfFileName(fileName) || storageExtensionForKind(kind);
  return `${userId}/${crypto.randomUUID()}.${ext}`;
}

export function parseIngestObjectKey(objectKey: string): {
  uuid: string;
  ext: string;
} | null {
  const m = objectKey.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([a-z0-9]+)$/i
  );
  if (!m) return null;
  return { uuid: m[1], ext: m[2].toLowerCase() };
}

export { UUID_RE };
