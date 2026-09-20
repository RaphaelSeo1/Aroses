import { extractPdfPages } from "@/lib/pdf-text/extract";
import { extractPptxSlides } from "@/lib/study-ingest/pptx";
import { detectIngestFormat, extensionOfFileName } from "@/lib/study-ingest/formats";
import {
  MAX_DECK_PAGES,
  deckPageFromExtract,
  type DeckPage,
} from "@/lib/live-notes/slide-pages";

export { deckPageFromExtract } from "@/lib/live-notes/slide-pages";

/**
 * Extract per-page/slide text from an uploaded lecture deck. PDF and PPTX
 * only — older .ppt is binary and is rejected with a conversion hint.
 */
export async function extractSlideDeckFromBuffer(input: {
  buffer: Buffer;
  fileName: string;
}): Promise<DeckPage[]> {
  const name = input.fileName.trim() || "deck";
  const ext = extensionOfFileName(name);
  const kind = detectIngestFormat(name);

  if (ext === "ppt" || (kind === "slides" && ext === "ppt")) {
    throw new Error(
      "Save as .pptx (PowerPoint 2007+) or export the deck as PDF, then upload again."
    );
  }

  if (kind === "pdf" || ext === "pdf") {
    const pages = await extractPdfPages(input.buffer, {
      maxPages: MAX_DECK_PAGES,
    });
    return pages
      .slice(0, MAX_DECK_PAGES)
      .map((p) => deckPageFromExtract(p.pageNum, p.text));
  }

  if (kind === "slides" || ext === "pptx") {
    const { slides } = await extractPptxSlides(input.buffer);
    return slides
      .slice(0, MAX_DECK_PAGES)
      .map((s) => {
        const parts = [s.body.trim()];
        if (s.notes.trim()) parts.push(`(Speaker notes: ${s.notes.trim()})`);
        return deckPageFromExtract(
          s.index,
          parts.filter(Boolean).join("\n"),
          s.title
        );
      });
  }

  throw new Error("Upload a PDF or PowerPoint (.pptx) of the lecture slides.");
}
