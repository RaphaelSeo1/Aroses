import type {
  ExtractedStudyContent,
  ExtractedStudyChunk,
} from "@/lib/study-ingest/extract";

/** Behind STRUCTURE_PLANNING — AI decides course structure from content, not file count. */
export function isStructurePlanningEnabled(): boolean {
  return process.env.STRUCTURE_PLANNING?.trim() === "1";
}

/**
 * A natural-boundary slice of one uploaded file. Many chunks may come from one
 * file (a dense PDF), and the planner may group chunks from several files into
 * a single lesson.
 */
export type IngestChunk = {
  /** Stable id used by the planner to reference this chunk (e.g. "c001"). */
  id: string;
  sourceFileName: string;
  /** Human-readable locator, e.g. "slide 4", "page ~3", "section 2", "00:12:30". */
  position: string;
  /** First heading / first line, truncated — feeds the token-cheap planner. */
  title: string;
  /** Full chunk text — used later for per-module expansion (not the planner). */
  text: string;
  approxChars: number;
};

/** Token-cheap view of a chunk sent to the planner (no full text). */
export type IngestChunkSummary = {
  id: string;
  sourceFileName: string;
  position: string;
  title: string;
  approxChars: number;
};

/** Per-file extracted content paired with its originating file name + kind. */
export type ExtractedPartForChunking = ExtractedStudyContent;

const MAX_CHUNK_CHARS = 6_000;
const MIN_CHUNK_CHARS = 400;
const MAX_TITLE_CHARS = 80;
const MAX_CHUNKS_TOTAL = 400;

function cleanTitleFromText(text: string): string {
  const firstLine =
    text
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "Untitled section";
  const stripped = firstLine.replace(/^[#>\-*\s]+/, "").trim();
  const title = stripped.length > 0 ? stripped : firstLine;
  return title.length > MAX_TITLE_CHARS
    ? `${title.slice(0, MAX_TITLE_CHARS - 1).trim()}…`
    : title;
}

/** True when a trimmed line looks like a section heading. */
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true; // markdown heading
  if (/^(chapter|section|part|unit|lecture|module|topic)\s+[0-9ivxlc]+/i.test(t)) {
    return true;
  }
  if (/^[0-9]+(\.[0-9]+)*\s+\S/.test(t)) return true; // "1.2 Foo"
  // ALL-CAPS short line (likely a slide/section title)
  if (t.length <= 60 && /^[A-Z0-9][A-Z0-9 ,:&/'\-]+$/.test(t) && /[A-Z]/.test(t)) {
    const words = t.split(/\s+/);
    if (words.length >= 1 && words.length <= 8) return true;
  }
  return false;
}

/** Split a long body into heading-delimited sections, then cap by length. */
function splitBodyIntoSections(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join("\n").trim();
    if (joined.length > 0) sections.push(joined);
    current = [];
  };

  for (const line of lines) {
    if (looksLikeHeading(line) && current.join("\n").trim().length >= MIN_CHUNK_CHARS) {
      flush();
    }
    current.push(line);
  }
  flush();

  // Length cap: break any section that is still too large on paragraph breaks.
  const capped: string[] = [];
  for (const section of sections.length > 0 ? sections : [body]) {
    if (section.length <= MAX_CHUNK_CHARS) {
      capped.push(section);
      continue;
    }
    const paras = section.split(/\n{2,}/);
    let buf = "";
    for (const para of paras) {
      if (buf.length + para.length + 2 > MAX_CHUNK_CHARS && buf.length > 0) {
        capped.push(buf.trim());
        buf = "";
      }
      buf += (buf.length > 0 ? "\n\n" : "") + para;
    }
    if (buf.trim().length > 0) capped.push(buf.trim());
  }

  return capped.filter((s) => s.trim().length > 0);
}

/** Locator text for a chunk based on file kind and ordinal within the file. */
function positionLabel(
  part: ExtractedStudyContent,
  chunkOrdinal: number,
  usedExistingChunk: boolean
): string {
  const kind = part.meta.kind;
  if (kind === "slides" && usedExistingChunk) {
    return `slide ${chunkOrdinal + 1}`;
  }
  if (kind === "audio" || kind === "video") {
    return `transcript part ${chunkOrdinal + 1}`;
  }
  if (kind === "pdf" && typeof part.meta.pageCount === "number" && part.meta.pageCount > 0) {
    return `section ${chunkOrdinal + 1}`;
  }
  return `section ${chunkOrdinal + 1}`;
}

/** Merge adjacent tiny slide chunks so the planner isn't flooded with stubs. */
function coalesceSmall(chunks: ExtractedStudyChunk[]): ExtractedStudyChunk[] {
  const out: ExtractedStudyChunk[] = [];
  for (const c of chunks) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.body.length < MIN_CHUNK_CHARS &&
      c.body.length < MIN_CHUNK_CHARS
    ) {
      out[out.length - 1] = {
        attribution: prev.attribution,
        body: `${prev.body}\n${c.body}`,
      };
    } else {
      out.push(c);
    }
  }
  return out;
}

/**
 * Turn per-file extracted content into id-tagged chunks along natural
 * boundaries. Slides reuse their per-slide chunks (coalescing tiny ones);
 * documents/transcripts are split by headings then capped by length.
 */
export function buildIngestChunks(parts: ExtractedStudyContent[]): IngestChunk[] {
  const chunks: IngestChunk[] = [];
  let counter = 0;

  const nextId = (): string => {
    counter += 1;
    return `c${String(counter).padStart(3, "0")}`;
  };

  for (const part of parts) {
    if (chunks.length >= MAX_CHUNKS_TOTAL) break;
    const fileName = part.meta.fileName;
    const kind = part.meta.kind;

    // Slides already arrive chunked per slide — reuse, coalescing tiny stubs.
    if (kind === "slides" && part.chunks.length > 1) {
      const slideChunks = coalesceSmall(part.chunks);
      for (let i = 0; i < slideChunks.length; i++) {
        if (chunks.length >= MAX_CHUNKS_TOTAL) break;
        const body = slideChunks[i].body.trim();
        if (body.length === 0) continue;
        chunks.push({
          id: nextId(),
          sourceFileName: fileName,
          position: positionLabel(part, i, true),
          title: cleanTitleFromText(body),
          text: body,
          approxChars: body.length,
        });
      }
      continue;
    }

    // Everything else: split the file's combined body by headings + length.
    const body = part.chunks.map((c) => c.body).join("\n\n").trim();
    if (body.length === 0) continue;
    const sections = splitBodyIntoSections(body);
    for (let i = 0; i < sections.length; i++) {
      if (chunks.length >= MAX_CHUNKS_TOTAL) break;
      const text = sections[i].trim();
      if (text.length === 0) continue;
      chunks.push({
        id: nextId(),
        sourceFileName: fileName,
        position: positionLabel(part, i, false),
        title: cleanTitleFromText(text),
        text,
        approxChars: text.length,
      });
    }
  }

  return chunks;
}

/** Strip full text so the planner call stays token-cheap. */
export function summarizeChunksForPlanner(
  chunks: IngestChunk[]
): IngestChunkSummary[] {
  return chunks.map((c) => ({
    id: c.id,
    sourceFileName: c.sourceFileName,
    position: c.position,
    title: c.title,
    approxChars: c.approxChars,
  }));
}
