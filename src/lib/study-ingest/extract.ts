import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import {
  extractPdfPagesForIngest,
  type PdfPageText,
} from "@/lib/pdf-text-head-tail";
import {
  detectIngestFormat,
  extensionOfFileName,
  type IngestFormatKind,
} from "@/lib/study-ingest/formats";
import { extractPptxSlides } from "@/lib/study-ingest/pptx";
import { rtfToPlainText } from "@/lib/study-ingest/rtf";
import { enhanceTabularPlaintext } from "@/lib/study-ingest/table-text";
import {
  transcribeMediaBuffer,
  transcriptWithTimestamps,
  type TranscriptionResult,
} from "@/lib/study-ingest/transcribe";

export type ExtractedSourceMeta = {
  fileName: string;
  kind: IngestFormatKind;
  pageCount?: number;
  wordCount?: number;
  slideCount?: number;
  transcript?: TranscriptionResult;
  retainStorage?: boolean;
  /** True when a fast head/tail read skipped middle pages (full read follows). */
  skippedMiddle?: boolean;
  /** True when page count exceeded PDF_INGEST_MAX_PAGES. */
  truncatedPages?: boolean;
};

export type ExtractedStudyChunk = {
  /** Attribution prefix, e.g. `[from lecture.pptx slide 4]` */
  attribution: string;
  body: string;
};

export type ExtractedStudyContent = {
  /** Combined plain text for outline generation (with attribution blocks). */
  plainText: string;
  chunks: ExtractedStudyChunk[];
  meta: ExtractedSourceMeta;
  /** Minimum chars gate — same threshold as PDF ingest. */
  charCount: number;
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function attributionPrefix(fileName: string, detail: string): string {
  return `[from ${fileName} ${detail}]`;
}

function envPositiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}

/** Merge adjacent pages into fewer chunks so long PDFs plan faster without losing text. */
function groupPdfPagesForChunks(
  pages: PdfPageText[],
  fileName: string
): ExtractedStudyChunk[] {
  const nonEmpty = pages.filter((p) => p.text.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  // 2 pages/chunk keeps section boundaries intact; section-split handles the rest.
  const pagesPerChunk =
    nonEmpty.length > 30
      ? Math.min(3, Math.max(2, Math.ceil(nonEmpty.length / 40)))
      : 1;

  if (pagesPerChunk <= 1) {
    return nonEmpty.map((p) => ({
      attribution: attributionPrefix(fileName, `page ${p.pageNum}`),
      body: enhanceTabularPlaintext(p.text.trim()),
    }));
  }

  const chunks: ExtractedStudyChunk[] = [];
  for (let i = 0; i < nonEmpty.length; i += pagesPerChunk) {
    const slice = nonEmpty.slice(i, i + pagesPerChunk);
    const body = slice
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (body.length === 0) continue;
    const start = slice[0]!.pageNum;
    const end = slice[slice.length - 1]!.pageNum;
    const detail =
      start === end ? `page ${start}` : `pages ${start}–${end}`;
    chunks.push({
      attribution: attributionPrefix(fileName, detail),
      body: enhanceTabularPlaintext(body),
    });
  }
  return chunks;
}

async function extractPdfBuffer(
  buf: Buffer,
  fileName: string,
  onHeartbeat?: () => void
): Promise<ExtractedStudyContent> {
  const safeMaxPages = envPositiveInt("PDF_INGEST_MAX_PAGES", 150, 400);
  const beat = onHeartbeat ? () => Promise.resolve(onHeartbeat()) : undefined;

  // Single PDF load + batched page render (no head/tail peek that re-parsed the file).
  const { pages, numpages, truncated } = await extractPdfPagesForIngest(buf, {
    maxPages: safeMaxPages,
    onHeartbeat: beat,
  });

  let pageChunks = groupPdfPagesForChunks(pages, fileName);

  if (pageChunks.length === 0) {
    const parsed = await pdfParse(buf, { max: safeMaxPages });
    const text = (parsed.text ?? "").trim();
    if (text.length >= 80) {
      const attr = attributionPrefix(fileName, "document");
      pageChunks = [{ attribution: attr, body: text }];
    }
  }

  if (pageChunks.length === 0) {
    throw new Error(
      "Not enough text extracted from this PDF. Try slides with selectable text or another file."
    );
  }

  const plainText = pageChunks
    .map((c) => `${c.attribution}\n${c.body}`)
    .join("\n\n");
  const combinedWordCount = wordCount(plainText);

  return {
    plainText,
    chunks: pageChunks.length > 1 ? pageChunks : [pageChunks[0]!],
    meta: {
      fileName,
      kind: "pdf",
      pageCount: numpages,
      wordCount: combinedWordCount,
      truncatedPages: truncated,
    },
    charCount: plainText.length,
  };
}

async function extractWordBuffer(
  buf: Buffer,
  fileName: string
): Promise<ExtractedStudyContent> {
  const ext = extensionOfFileName(fileName);
  if (ext === "doc") {
    throw new Error(
      "Legacy .doc files aren't supported yet. Save as .docx in Word or export as PDF."
    );
  }
  try {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    const text = (value ?? "").trim();
    if (text.length < 80) {
      throw new Error(
        "Not enough text found in this Word document. Try exporting as PDF."
      );
    }
    const attr = attributionPrefix(fileName, "document");
    return {
      plainText: `${attr}\n${text}`,
      chunks: [{ attribution: attr, body: text }],
      meta: { fileName, kind: "word", wordCount: wordCount(text) },
      charCount: text.length,
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Not enough")) throw e;
    throw new Error(
      "Could not read this Word file. It may be damaged — try saving as .docx or PDF."
    );
  }
}

async function extractSlidesBuffer(
  buf: Buffer,
  fileName: string
): Promise<ExtractedStudyContent> {
  const ext = extensionOfFileName(fileName);
  if (ext === "ppt") {
    throw new Error(
      "Legacy .ppt files aren't supported yet. Save as .pptx or export as PDF."
    );
  }
  const { slides, plainText } = await extractPptxSlides(buf);
  if (plainText.length < 80) {
    throw new Error(
      "Not enough text on these slides. Try a deck with text or export as PDF."
    );
  }
  const chunks: ExtractedStudyChunk[] = slides.map((s) => {
    const detail = `slide ${s.index}`;
    const body = [s.title, s.body, s.notes ? `(Notes: ${s.notes})` : ""]
      .filter(Boolean)
      .join("\n");
    return {
      attribution: attributionPrefix(fileName, detail),
      body,
    };
  });
  const combined = chunks
    .map((c) => `${c.attribution}\n${c.body}`)
    .join("\n\n");
  return {
    plainText: combined,
    chunks,
    meta: { fileName, kind: "slides", slideCount: slides.length, wordCount: wordCount(plainText) },
    charCount: plainText.length,
  };
}

function extractTextLikeBuffer(
  buf: Buffer,
  fileName: string,
  kind: "text" | "markdown" | "rtf"
): ExtractedStudyContent {
  const raw =
    kind === "rtf"
      ? rtfToPlainText(buf.toString("utf8"))
      : buf.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (raw.length < 80) {
    throw new Error("Not enough text in this file to build a course.");
  }
  const attr = attributionPrefix(fileName, kind === "markdown" ? "markdown" : "document");
  return {
    plainText: `${attr}\n${raw}`,
    chunks: [{ attribution: attr, body: raw }],
    meta: { fileName, kind, wordCount: wordCount(raw) },
    charCount: raw.length,
  };
}

function imageMediaType(
  fileName: string
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  const ext = extensionOfFileName(fileName);
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg" || ext === "heic" || ext === "heif") {
    return "image/jpeg";
  }
  return null;
}

async function extractImageBuffer(
  buf: Buffer,
  fileName: string,
  imageIndex?: number
): Promise<ExtractedStudyContent> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Image reading requires ANTHROPIC_API_KEY on the server. Upload a PDF or text file instead."
    );
  }
  const mediaType = imageMediaType(fileName);
  if (!mediaType) {
    throw new Error(
      "This image format isn't supported yet. Try PNG or JPEG."
    );
  }

  const detail =
    typeof imageIndex === "number"
      ? `image ${imageIndex + 1}`
      : "image";
  const attr = attributionPrefix(fileName, detail);

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_FAST_MODEL?.trim() || "claude-haiku-4-5",
    max_tokens: 4096,
    temperature: 0.2,
    system: `You extract study material from photos for course generation. For each image:
1. Transcribe ALL visible text (handwriting, slides, textbook pages) accurately.
2. Describe diagrams, charts, equations, and whiteboard drawings briefly.
3. Preserve structure with headings where obvious.

Output plain text only — no markdown code fences.`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: buf.toString("base64"),
            },
          },
          {
            type: "text",
            text: `FILENAME: ${fileName}\n\nExtract all study content from this image.`,
          },
        ],
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text.trim() : "";
  if (text.length < 40) {
    throw new Error(
      "I couldn't read text from this image. Make sure the photo is in focus and well-lit."
    );
  }

  return {
    plainText: `${attr}\n${text}`,
    chunks: [{ attribution: attr, body: text }],
    meta: { fileName, kind: "image", wordCount: wordCount(text) },
    charCount: text.length,
  };
}

async function extractMediaBuffer(
  buf: Buffer,
  fileName: string,
  kind: "audio" | "video"
): Promise<ExtractedStudyContent> {
  const transcript = await transcribeMediaBuffer(buf, fileName);
  const body = transcriptWithTimestamps(transcript);
  const attr = attributionPrefix(fileName, "transcript");
  return {
    plainText: `${attr}\n${body}`,
    chunks: [{ attribution: attr, body }],
    meta: {
      fileName,
      kind,
      wordCount: wordCount(body),
      transcript,
      retainStorage: true,
    },
    charCount: body.length,
  };
}

export async function extractStudyMaterialFromBuffer(input: {
  buffer: Buffer;
  fileName: string;
  kind?: IngestFormatKind | null;
  imageIndex?: number;
  onHeartbeat?: () => void;
}): Promise<ExtractedStudyContent> {
  const kind =
    input.kind ?? detectIngestFormat(input.fileName) ?? null;
  if (!kind) {
    throw new Error(
      "This file format isn't supported yet. Try PDF, Word (.docx), PowerPoint (.pptx), text, images, or audio."
    );
  }

  switch (kind) {
    case "pdf":
      return extractPdfBuffer(input.buffer, input.fileName, input.onHeartbeat);
    case "word":
      return extractWordBuffer(input.buffer, input.fileName);
    case "slides":
      return extractSlidesBuffer(input.buffer, input.fileName);
    case "text":
    case "markdown":
      return extractTextLikeBuffer(input.buffer, input.fileName, kind);
    case "rtf":
      return extractTextLikeBuffer(input.buffer, input.fileName, "rtf");
    case "image":
      return extractImageBuffer(input.buffer, input.fileName, input.imageIndex);
    case "audio":
    case "video":
      return extractMediaBuffer(input.buffer, input.fileName, kind);
    default:
      throw new Error("Unsupported file type.");
  }
}
