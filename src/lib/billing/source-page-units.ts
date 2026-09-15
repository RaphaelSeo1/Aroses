import type { IngestFormatKind } from "@/lib/study-ingest/formats";

/**
 * Normalized "source page equivalent" used for billing.
 *
 * User-facing term: "Source pages"
 * Tooltip: "PDF pages and equivalent source material."
 *
 * Never expose token counts.
 *
 * PDF: actual page count (minimum 1 for a non-empty file)
 * PPTX / presentation: 1 slide = 1 page
 * Image: 1 image = 1 page
 * DOCX / TXT / MD / RTF: ceil(wordCount / 500), minimum 1 if non-empty
 * Transcribed audio/video used for course generation: ceil(transcriptWordCount / 500)
 */

export const WORDS_PER_SOURCE_PAGE = 500;

export type SourceUnitInput = {
  kind: IngestFormatKind | string;
  pageCount?: number | null;
  slideCount?: number | null;
  wordCount?: number | null;
  imageCount?: number | null;
};

export function textSourcePageUnits(wordCount: number): number {
  const words = Math.max(0, Math.trunc(wordCount));
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_SOURCE_PAGE));
}

export function sourcePageUnitsForFile(input: SourceUnitInput): number {
  const kind = String(input.kind ?? "").toLowerCase();
  if (kind === "pdf") {
    const pages = Math.max(0, Math.trunc(input.pageCount ?? 0));
    return pages > 0 ? pages : 0;
  }
  if (kind === "slides" || kind === "pptx" || kind === "ppt") {
    const slides = Math.max(
      0,
      Math.trunc(input.slideCount ?? input.pageCount ?? 0)
    );
    return slides > 0 ? slides : 0;
  }
  if (kind === "image") {
    const n = Math.max(1, Math.trunc(input.imageCount ?? 1));
    return n;
  }
  if (
    kind === "word" ||
    kind === "docx" ||
    kind === "doc" ||
    kind === "text" ||
    kind === "txt" ||
    kind === "markdown" ||
    kind === "md" ||
    kind === "rtf" ||
    kind === "audio" ||
    kind === "video"
  ) {
    return textSourcePageUnits(input.wordCount ?? 0);
  }
  const pages = Math.max(0, Math.trunc(input.pageCount ?? 0));
  if (pages > 0) return pages;
  return textSourcePageUnits(input.wordCount ?? 0);
}

export function sumSourcePageUnits(files: SourceUnitInput[]): number {
  return files.reduce((sum, f) => sum + sourcePageUnitsForFile(f), 0);
}
