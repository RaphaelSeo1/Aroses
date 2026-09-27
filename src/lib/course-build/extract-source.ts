import type { SupabaseClient } from "@supabase/supabase-js";
import mammoth from "mammoth";
import { extractPdfPagesForIngest } from "@/lib/pdf-text-head-tail";
import { extractPptxSlides } from "@/lib/study-ingest/pptx";
import { paginateText, type SourcePage } from "./clean.ts";
import { StepFatalError } from "./errors.ts";
import type { ExtractFn, SourceRecord } from "./handlers.ts";

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

/** Raw page text per file type. Cleaning happens in the extract step. */
export function createSourceExtractor(admin: SupabaseClient): ExtractFn {
  return async (source) => {
    const buf = await download(admin, source);
    try {
      if (source.kind === "pdf") {
        const { pages } = await extractPdfPagesForIngest(buf);
        return pages.map((p): SourcePage => ({ n: p.pageNum, text: p.text }));
      }
      if (source.kind === "pptx") {
        const { slides } = await extractPptxSlides(buf);
        return slides.map((s): SourcePage => ({
          n: s.index,
          text: [s.body, s.notes ? `Speaker notes: ${s.notes}` : ""].filter(Boolean).join("\n"),
        }));
      }
      if (source.kind === "docx") {
        const { value } = await mammoth.extractRawText({ buffer: buf });
        return paginateText(value);
      }
    } catch (err) {
      if (err instanceof StepFatalError) throw err;
      throw unreadable(source);
    }
    throw new StepFatalError("unsupported_source", `${source.label} is a file type the course builder can't read yet.`);
  };
}
