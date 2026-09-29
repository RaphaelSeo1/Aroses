/**
 * Page counts on the upload screen, in the browser, before anything is
 * uploaded. They match how the build counts: PDF pages, slides, and 500
 * words a page for documents, text and transcripts. Recordings are an
 * estimate from their length. Null when the file can't be read here; the
 * build still counts it exactly.
 */
import { detectIngestFormat, extensionOfFileName } from "@/lib/study-ingest/formats";

const WORDS_PER_PAGE = 500;
/** Lecture speech, words per minute, for estimating a recording's transcript. */
const SPOKEN_WORDS_PER_MINUTE = 140;

export type ClientPageCount = { pages: number; approx: boolean };

function words(text: string): number {
  const latin = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  // Chinese and Japanese have no spaces; count about two characters a word.
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0;
  return latin + Math.ceil(cjk / 2);
}

export function textPages(text: string): number {
  const n = words(text);
  return n > 0 ? Math.max(1, Math.ceil(n / WORDS_PER_PAGE)) : 0;
}

async function pdfPages(file: File): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, useSystemFonts: false });
  const pdf = await task.promise;
  try {
    return pdf.numPages;
  } finally {
    void task.destroy();
  }
}

async function officePages(file: File, kind: "pptx" | "docx"): Promise<number> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (kind === "pptx") return Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  return textPages(xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, " "));
}

function mediaMinutes(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    const done = (v: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 8_000);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration / 60 : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

export async function countFilePages(file: File): Promise<ClientPageCount | null> {
  const kind = detectIngestFormat(file.name, file.type);
  const ext = extensionOfFileName(file.name);
  try {
    if (kind === "pdf") return { pages: await pdfPages(file), approx: false };
    if (kind === "slides" && ext === "pptx") return { pages: await officePages(file, "pptx"), approx: false };
    if (kind === "word" && ext === "docx") return { pages: Math.max(1, await officePages(file, "docx")), approx: false };
    if (kind === "text" || kind === "markdown" || kind === "rtf") return { pages: Math.max(1, textPages(await file.text())), approx: false };
    if (kind === "audio" || kind === "video") {
      const minutes = await mediaMinutes(file);
      return minutes == null ? null : { pages: Math.max(1, Math.ceil((minutes * SPOKEN_WORDS_PER_MINUTE) / WORDS_PER_PAGE)), approx: true };
    }
  } catch {
    return null;
  }
  return null;
}
