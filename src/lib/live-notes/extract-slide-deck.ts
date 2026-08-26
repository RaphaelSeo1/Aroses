import { extractPdfPagesForIngest } from "@/lib/pdf-text-head-tail";
import { extractPptxSlides } from "@/lib/study-ingest/pptx";
import { detectIngestFormat, extensionOfFileName } from "@/lib/study-ingest/formats";
import {
  MAX_DECK_PAGES,
  titleFromSlideText,
  type DeckPage,
} from "@/lib/live-notes/slide-pages";

const MIN_PAGE_CHARS = 12;

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
    const { pages } = await extractPdfPagesForIngest(input.buffer, {
      maxPages: MAX_DECK_PAGES,
    });
    return pages
      .map((p) => {
        const text = p.text.trim();
        if (text.length < MIN_PAGE_CHARS) return null;
        return {
          pageNum: p.pageNum,
          title: titleFromSlideText(text, `Slide ${p.pageNum}`),
          extractedText: text.slice(0, 8_000),
        };
      })
      .filter((p): p is DeckPage => Boolean(p));
  }

  if (kind === "slides" || ext === "pptx") {
    const { slides } = await extractPptxSlides(input.buffer);
    return slides
      .slice(0, MAX_DECK_PAGES)
      .map((s) => {
        const parts = [s.body.trim()];
        if (s.notes.trim()) parts.push(`(Speaker notes: ${s.notes.trim()})`);
        const text = parts.filter(Boolean).join("\n").trim();
        if (text.length < MIN_PAGE_CHARS) return null;
        return {
          pageNum: s.index,
          title: (s.title || titleFromSlideText(text, `Slide ${s.index}`)).slice(
            0,
            120
          ),
          extractedText: text.slice(0, 8_000),
        };
      })
      .filter((p): p is DeckPage => Boolean(p));
  }

  throw new Error("Upload a PDF or PowerPoint (.pptx) of the lecture slides.");
}
