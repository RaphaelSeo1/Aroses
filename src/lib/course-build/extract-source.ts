import type { SupabaseClient } from "@supabase/supabase-js";
import mammoth from "mammoth";
import { extractPdfPagesForIngest } from "@/lib/pdf-text-head-tail";
import JSZip from "jszip";
import { rtfToPlainText } from "@/lib/study-ingest/rtf";
import { paginateText, type SourcePage } from "./clean.ts";
import { StepFatalError } from "./errors.ts";
import { findPdfFigures } from "./figures-pdf.ts";
import type { ExtractFn, FindFiguresFn, SourceRecord } from "./handlers.ts";
import { docxHtmlToText, slideXmlToText } from "./office-text.ts";
import { extractPdfPagesWithTables } from "./pdf-text.ts";
import { transcribeMediaUrl } from "./transcribe.ts";

export const COURSE_BUILD_UPLOAD_BUCKET = "study-pdf-ingest";

async function download(admin: SupabaseClient, source: SourceRecord): Promise<Buffer> {
  if (!source.storagePath) {
    throw new StepFatalError("source_missing", `${source.label} was not uploaded.`);
  }
  const { data, error } = await admin.storage.from(COURSE_BUILD_UPLOAD_BUCKET).download(source.storagePath);
  if (error || !data) {
    // Storage hiccups are worth a retry; the runner retries plain errors.
    throw new Error(`download ${source.storagePath}: ${error?.message ?? "no data"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

function unreadable(source: SourceRecord): StepFatalError {
  return new StepFatalError(
    "file_unreadable",
    `We couldn't read ${source.label}. It may be damaged or password-protected. Try exporting it again.`
  );
}

const SIGNED_URL_SECONDS = 60 * 60;

export function createFigureFinder(
  admin: SupabaseClient,
  opts: { maxRenderPages: number; timeBudgetMs: number }
): FindFiguresFn {
  return async (source, signal, find) => {
    const deadlineAt = Date.now() + opts.timeBudgetMs;
    const buf = await download(admin, source);
    return findPdfFigures(buf, { ...opts, deadlineAt, signal, tablePages: find?.tablePages });
  };
}

/** One page per slide, in slide order, with speaker notes after the slide text. */
async function pptxPages(buf: Buffer): Promise<SourcePage[]> {
  const zip = await JSZip.loadAsync(buf);
  const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => num(a) - num(b));
  if (names.length === 0) throw new Error("no slides");
  return Promise.all(
    names.map(async (name, i): Promise<SourcePage> => {
      const body = slideXmlToText((await zip.file(name)?.async("string")) ?? "");
      const notesXml = await zip.file(`ppt/notesSlides/notesSlide${num(name)}.xml`)?.async("string");
      const notes = notesXml ? slideXmlToText(notesXml).replace(/\n/g, " ").trim() : "";
      return { n: i + 1, text: [body, notes ? `Speaker notes: ${notes}` : ""].filter(Boolean).join("\n") };
    })
  );
}

/** Raw page text per file type. Cleaning happens in the extract step. */
export function createSourceExtractor(admin: SupabaseClient): ExtractFn {
  return async (source) => {
    if (source.kind === "audio" || source.kind === "video") {
      if (!source.storagePath) throw new StepFatalError("source_missing", `${source.label} was not uploaded.`);
      const { data, error } = await admin.storage
        .from(COURSE_BUILD_UPLOAD_BUCKET)
        .createSignedUrl(source.storagePath, SIGNED_URL_SECONDS);
      if (error || !data?.signedUrl) throw new Error(`sign ${source.storagePath}: ${error?.message ?? "no url"}`);
      return paginateText(await transcribeMediaUrl(data.signedUrl, source.label));
    }

    const buf = await download(admin, source);
    if (source.kind === "text") {
      const raw = buf.toString("utf8");
      return paginateText(/\.rtf$/i.test(source.storagePath ?? "") ? rtfToPlainText(raw) : raw);
    }
    try {
      if (source.kind === "pdf") {
        try {
          return await extractPdfPagesWithTables(buf);
        } catch {
          const { pages } = await extractPdfPagesForIngest(buf);
          return pages.map((p): SourcePage => ({ n: p.pageNum, text: p.text }));
        }
      }
      if (source.kind === "pptx") return await pptxPages(buf);
      if (source.kind === "docx") {
        const { value } = await mammoth.convertToHtml({ buffer: buf });
        return paginateText(docxHtmlToText(value));
      }
    } catch (err) {
      if (err instanceof StepFatalError) throw err;
      throw unreadable(source);
    }
    throw new StepFatalError("unsupported_source", `${source.label} is a file type the course builder can't read yet.`);
  };
}
