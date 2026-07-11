import {
  detectIngestFormat,
  maxBytesForKind,
} from "@/lib/study-ingest/formats";
import { extractStudyMaterialFromBuffer } from "@/lib/study-ingest/extract";
import { extractPdfText } from "@/lib/pdf-text/extract";
import {
  summarizeImageUpload,
  summarizePdfUpload,
} from "@/lib/ai/tutor-session";
import { fetchReferenceUrl } from "@/lib/fetch-reference-url";

import {
  TUTOR_SESSION_MAX_FILES,
  TUTOR_SESSION_MAX_TOTAL_BYTES,
} from "@/lib/tutor-session/upload-limits";

export type TutorExtractResult = {
  extractedContent: string;
  summary: string;
};

export type TutorLinkExtractResult = TutorExtractResult & {
  fileName: string;
  sourceUrl: string;
};

function imageMediaType(
  mime: string
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (mime === "image/png") return "image/png";
  if (mime === "image/gif") return "image/gif";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/jpeg") return "image/jpeg";
  return null;
}

/**
 * Extract + summarize one tutor-session reference file.
 */
export async function extractTutorSessionUpload(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<TutorExtractResult> {
  const kind = detectIngestFormat(input.fileName, input.mimeType);
  if (!kind) {
    throw new Error(`Unsupported file type: ${input.fileName}`);
  }

  if (kind === "audio" || kind === "video") {
    throw new Error(
      `${input.fileName}: audio and video are not supported in tutor sessions yet — use course upload for recordings.`
    );
  }

  if (input.buffer.length > maxBytesForKind(kind)) {
    const maxMb = Math.round(maxBytesForKind(kind) / (1024 * 1024));
    throw new Error(`${input.fileName} exceeds the ${maxMb}MB limit.`);
  }

  if (kind === "pdf") {
    const extractedContent = (await extractPdfText(input.buffer)).slice(0, 30_000);
    const summary = extractedContent
      ? await summarizePdfUpload({
          fileName: input.fileName,
          extractedText: extractedContent,
        })
      : `(${input.fileName} — couldn't extract text; might be a scanned PDF.)`;
    return { extractedContent, summary };
  }

  if (kind === "image") {
    const mediaType = imageMediaType(input.mimeType);
    if (!mediaType) {
      throw new Error(`${input.fileName}: unsupported image type.`);
    }
    const summary = await summarizeImageUpload({
      fileName: input.fileName,
      imageBase64: input.buffer.toString("base64"),
      mediaType,
    });
    return { extractedContent: summary, summary };
  }

  const part = await extractStudyMaterialFromBuffer({
    buffer: input.buffer,
    fileName: input.fileName,
    kind,
  });
  const extractedContent = part.plainText.slice(0, 30_000);
  const summary = extractedContent
    ? await summarizePdfUpload({
        fileName: input.fileName,
        extractedText: extractedContent,
      })
    : `(${input.fileName})`;
  return { extractedContent, summary };
}

/**
 * Fetch a URL and summarize it as tutor-session reference context.
 */
export async function extractTutorSessionLink(
  rawUrl: string
): Promise<TutorLinkExtractResult> {
  const fetched = await fetchReferenceUrl(rawUrl);
  const extractedContent = fetched.text.slice(0, 30_000);
  const displayName = fetched.title || fetched.hostname;
  const summary = await summarizePdfUpload({
    fileName: displayName,
    extractedText: extractedContent,
  });
  return {
    extractedContent,
    summary,
    fileName: displayName.slice(0, 200),
    sourceUrl: fetched.url,
  };
}

export function validateTutorSessionBatch(files: File[]): string | null {
  if (files.length > TUTOR_SESSION_MAX_FILES) {
    return `At most ${TUTOR_SESSION_MAX_FILES} files at a time.`;
  }
  let total = 0;
  for (const f of files) {
    if (!detectIngestFormat(f.name, f.type)) {
      return `Unsupported file: ${f.name}`;
    }
    total += f.size;
    if (f.size > maxBytesForKind(detectIngestFormat(f.name, f.type)!)) {
      return `${f.name} is too large for this upload.`;
    }
  }
  if (total > TUTOR_SESSION_MAX_TOTAL_BYTES) {
    return `Combined upload exceeds 200MB.`;
  }
  return null;
}
