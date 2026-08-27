import "server-only";
import { extractPdfText } from "@/lib/pdf-text/extract";
import { MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { isValidIngestStoragePath } from "@/lib/study-ingest/path";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createAdminClient } from "@/lib/supabase/admin";

/** Cap so a worksheet/handout fits beside notes + transcript. */
export const MAX_CHAT_PDF_CHARS = 16_000;
export const MAX_CHAT_PDF_BYTES = MAX_INGEST_DOCUMENT_BYTES;

export type ChatPdfExtractResult =
  | { ok: true; text: string; fileName: string }
  | { ok: false; status: number; error: string };

/**
 * Download a PDF the student uploaded to study-pdf-ingest, extract selectable
 * text, then remove the storage object (chat only needs the extract).
 */
export async function extractChatPdfFromStorage(input: {
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
    "attachment.pdf";
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return {
      ok: false,
      status: 400,
      error: "Attach a PDF.",
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
  if (buffer.length > MAX_CHAT_PDF_BYTES) {
    await admin.storage.from(STUDY_PDF_INGEST_BUCKET).remove([storagePath]).catch(() => {});
    const maxMb = Math.round(MAX_CHAT_PDF_BYTES / (1024 * 1024));
    return {
      ok: false,
      status: 400,
      error: `That PDF is too large. Maximum is ${maxMb}MB.`,
    };
  }

  const raw = (await extractPdfText(buffer)).trim();
  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove([storagePath])
    .catch(() => {});

  if (raw.length < 12) {
    return {
      ok: false,
      status: 400,
      error:
        "Couldn't read text from that PDF. Export it with selectable text (not a scan) and try again.",
    };
  }

  return {
    ok: true,
    fileName,
    text: raw.slice(0, MAX_CHAT_PDF_CHARS),
  };
}
