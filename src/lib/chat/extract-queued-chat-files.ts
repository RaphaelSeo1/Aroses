import { describePdfIngestUploadFailure } from "@/lib/storage-upload-errors";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_CHAT_ATTACHMENT_CHARS,
  MAX_CHAT_ATTACHMENTS,
} from "@/lib/chat/chat-attachment-formats";

export const CHAT_EXTRACT_ATTACHMENT_URL = "/api/chat/extract-attachment";

export type ExtractedChatAttachment = { fileName: string; text: string };

export function mergeExtractedChatAttachments(
  parts: ExtractedChatAttachment[],
  maxChars = MAX_CHAT_ATTACHMENT_CHARS
): ExtractedChatAttachment {
  const per = Math.max(1_200, Math.floor(maxChars / Math.max(1, parts.length)));
  return {
    fileName: parts
      .map((p) => p.fileName)
      .join(", ")
      .slice(0, 200),
    text: parts
      .map((p) => `### ${p.fileName}\n${p.text.slice(0, per)}`)
      .join("\n\n")
      .slice(0, maxChars),
  };
}

/**
 * Upload queued files to study-pdf-ingest, extract text on the server, delete
 * the storage objects. Shared by lecture, calendar, and study Ask Rose.
 */
export async function extractQueuedChatFiles(input: {
  files: File[];
  extractUrl?: string;
}): Promise<
  | { ok: true; parts: ExtractedChatAttachment[]; combined: ExtractedChatAttachment }
  | { ok: false; error: string }
> {
  const files = input.files.slice(0, MAX_CHAT_ATTACHMENTS);
  if (files.length === 0) {
    return { ok: false, error: "Attach a file first." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return { ok: false, error: "Sign in again, then retry the upload." };
  }

  const extractUrl = input.extractUrl ?? CHAT_EXTRACT_ATTACHMENT_URL;
  const parts: ExtractedChatAttachment[] = [];

  for (const file of files) {
    const pathInfo = ingestStoragePathForFile(user.id, file);
    if (!pathInfo) {
      return {
        ok: false,
        error: "This chat can use PDFs, Word, slides, images, and text files.",
      };
    }

    const { error: upErr } = await supabase.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .upload(pathInfo.storagePath, file, {
        contentType: pathInfo.contentType,
        cacheControl: "3600",
        upsert: false,
      });
    if (upErr) {
      return {
        ok: false,
        error: describePdfIngestUploadFailure(
          typeof upErr.message === "string" ? upErr.message : String(upErr)
        ),
      };
    }

    try {
      const res = await fetch(extractUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: pathInfo.storagePath,
          fileName: file.name,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        fileName?: string;
        text?: string;
      };
      if (!res.ok || typeof body.text !== "string" || !body.text.trim()) {
        await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .remove([pathInfo.storagePath])
          .catch(() => {});
        return {
          ok: false,
          error: body.error || `Could not read ${file.name}.`,
        };
      }
      parts.push({
        fileName: (body.fileName ?? file.name).slice(0, 200),
        text: body.text.trim(),
      });
    } catch {
      await supabase.storage
        .from(STUDY_PDF_INGEST_BUCKET)
        .remove([pathInfo.storagePath])
        .catch(() => {});
      return { ok: false, error: `Could not read ${file.name}.` };
    }
  }

  return {
    ok: true,
    parts,
    combined: mergeExtractedChatAttachments(parts),
  };
}
