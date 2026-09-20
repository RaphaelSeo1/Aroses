"use client";

import { detectIngestFormat, extensionOfFileName } from "@/lib/study-ingest/formats";
import { extractPptxSlides } from "@/lib/study-ingest/pptx";
import {
  MAX_DECK_PAGES,
  deckPageFromExtract,
  type DeckPage,
} from "@/lib/live-notes/slide-pages";

const PAGE_BATCH = 12;

type TextItem = { str?: string; hasEOL?: boolean };

function pageTextFromItems(items: TextItem[]): string {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    if (typeof item.str === "string") current += item.str;
    if (item.hasEOL) {
      if (current.trim().length > 0) lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length > 0) lines.push(current.trim());
  return lines.join("\n").trim();
}

async function extractPdfInBrowser(data: ArrayBuffer): Promise<DeckPage[]> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, MAX_DECK_PAGES);
  const pages: DeckPage[] = [];
  try {
    for (let start = 1; start <= pageCount; start += PAGE_BATCH) {
      const end = Math.min(start + PAGE_BATCH - 1, pageCount);
      const batch = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => start + i).map(
          async (pageNum) => {
            const page = await pdf.getPage(pageNum);
            try {
              const content = await page.getTextContent();
              const items = (content.items as TextItem[]) ?? [];
              return deckPageFromExtract(pageNum, pageTextFromItems(items));
            } finally {
              page.cleanup();
            }
          }
        )
      );
      pages.push(...batch);
    }
  } finally {
    await pdf.destroy().catch(() => {});
  }
  return pages;
}

async function extractPptxInBrowser(data: ArrayBuffer): Promise<DeckPage[]> {
  const { slides } = await extractPptxSlides(new Uint8Array(data));
  return slides.slice(0, MAX_DECK_PAGES).map((s) => {
    const parts = [s.body.trim()];
    if (s.notes.trim()) parts.push(`(Speaker notes: ${s.notes.trim()})`);
    return deckPageFromExtract(
      s.index,
      parts.filter(Boolean).join("\n"),
      s.title
    );
  });
}

/**
 * Read slide text on the user's machine so the server does not have to
 * download the file again. Returns null when the local parser cannot
 * produce pages — the API then falls back to server extraction.
 */
export async function extractSlideDeckInBrowser(
  file: File
): Promise<DeckPage[] | null> {
  const name = file.name.trim() || "deck";
  const ext = extensionOfFileName(name);
  const kind = detectIngestFormat(name, file.type);
  try {
    const data = await file.arrayBuffer();
    if (kind === "pdf" || ext === "pdf") {
      const pages = await extractPdfInBrowser(data);
      return pages.length > 0 ? pages : null;
    }
    if (kind === "slides" || ext === "pptx") {
      const pages = await extractPptxInBrowser(data);
      return pages.length > 0 ? pages : null;
    }
    return null;
  } catch (e) {
    console.warn("[live-notes client slide extract]", e);
    return null;
  }
}
