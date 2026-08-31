import "server-only";
import {
  CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE,
  isChatAttachmentKind,
  maxBytesForChatKind,
  MAX_CHAT_ATTACHMENT_CHARS,
  MIN_CHAT_ATTACHMENT_CHARS,
  type ChatAttachmentKind,
} from "@/lib/chat/chat-attachment-formats";
import { extractPdfText } from "@/lib/pdf-text/extract";
import { extractStudyMaterialFromBuffer } from "@/lib/study-ingest/extract";
import { detectIngestFormat, MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { isValidIngestStoragePath } from "@/lib/study-ingest/path";
import { rtfToPlainText } from "@/lib/study-ingest/rtf";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createAdminClient } from "@/lib/supabase/admin";

/** @deprecated Use MAX_CHAT_ATTACHMENT_CHARS — kept so existing chat routes typecheck. */
export const MAX_CHAT_PDF_CHARS = MAX_CHAT_ATTACHMENT_CHARS;
export const MAX_CHAT_PDF_BYTES = MAX_INGEST_DOCUMENT_BYTES;

export type ChatPdfExtractResult =
  | { ok: true; text: string; fileName: string; kind: ChatAttachmentKind }
  | { ok: false; status: number; error: string };

function emptyFileError(kind: ChatAttachmentKind): string {
  if (kind === "pdf") {
    return "Couldn't read text from that PDF. Export it with selectable text (not a scan) and try again.";
  }
  if (kind === "image") {
    return "I couldn't read text from this image. Make sure the photo is in focus and well-lit.";
  }
  return "Couldn't read enough text from that file. Try another document or a clearer photo.";
}

async function extractChatText(
  buffer: Buffer,
  fileName: string,
  kind: ChatAttachmentKind
): Promise<string> {
  if (kind === "pdf") {
    return (await extractPdfText(buffer)).trim();
  }
  if (kind === "text" || kind === "markdown") {
    return buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  }
  if (kind === "rtf") {
    return rtfToPlainText(buffer.toString("utf8")).trim();
  }
  const part = await extractStudyMaterialFromBuffer({
    buffer,
    fileName,
    kind,
  });
  return part.plainText.trim();
}

/**
 * Download a chat attachment from study-pdf-ingest, extract text (PDF / Word /
 * slides / text / image OCR), then remove the storage object.
 */
export async function extractChatAttachmentFromStorage(input: {
  storagePath: string;
  userId: string;
  fileName?: string;
}): Promise<ChatPdfExtractResult> {
  const storagePath = input.storagePath.trim();
  if (!isValidIngestStoragePath(storagePath, input.userId)) {
    return { ok: false, status: 400, error: "Invalid storage path" };
  }
  const fileName =
    input.fileName?.trim().slice(0, 200) ||
    storagePath.split("/").pop() ||
    "attachment";
  const kind = detectIngestFormat(fileName) ?? detectIngestFormat(storagePath);
  if (!isChatAttachmentKind(kind)) {
    return {
      ok: false,
      status: 400,
      error: CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      status: 500,
      error:
        "Server is not configured for storage. Set SUPABASE_SERVICE_ROLE_KEY on the host, then redeploy.",
    };
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .download(storagePath);
  if (dlErr || !blob) {
    return {
      ok: false,
      status: 400,
      error: "Could not read the uploaded file. Try attaching it again.",
    };
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const maxBytes = maxBytesForChatKind(kind);
  if (buffer.length > maxBytes) {
    await admin.storage.from(STUDY_PDF_INGEST_BUCKET).remove([storagePath]).catch(() => {});
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      status: 400,
      error: `That file is too large. Maximum is ${maxMb}MB.`,
    };
  }

  let raw = "";
  try {
    raw = await extractChatText(buffer, fileName, kind);
  } catch (e) {
    await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .remove([storagePath])
      .catch(() => {});
    const msg = e instanceof Error ? e.message.trim() : "";
    return {
      ok: false,
      status: 400,
      error: msg || emptyFileError(kind),
    };
  }

  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove([storagePath])
    .catch(() => {});

  if (raw.length < MIN_CHAT_ATTACHMENT_CHARS) {
    return {
      ok: false,
      status: 400,
      error: emptyFileError(kind),
    };
  }

  return {
    ok: true,
    fileName,
    kind,
    text: raw.slice(0, MAX_CHAT_ATTACHMENT_CHARS),
  };
}

/** @deprecated Prefer extractChatAttachmentFromStorage. */
export async function extractChatPdfFromStorage(input: {
  storagePath: string;
  userId: string;
  fileName?: string;
}): Promise<ChatPdfExtractResult> {
  return extractChatAttachmentFromStorage(input);
}
