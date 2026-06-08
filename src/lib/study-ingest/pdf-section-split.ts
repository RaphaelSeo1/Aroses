import { normalizeIngestDisplayTitle } from "@/lib/study-ingest/normalize-ingest-title";

/** Major lecture sections in the CNS pharmacology deck (Ch.3). */
const MAJOR_SECTION_HEADING =
  /^(?:_\s*\[\s*\d+\s*\]\s*)?(?:\d+[\.\)]\s*)?(?:개요|전신마취(?:제)?|수면제|항뇌전증(?:제)?|마약(?:성)?진통(?:제)?|항파킨슨(?:병)?(?:제)?|파킨슨(?:병)?(?:제)?|알츠하이머(?:병)?(?:치료제)?|항정신(?:병)?(?:제)?|항불안(?:제)?|기분장애(?:치료제)?|중추신경자극(?:제)?)/;

/** Slide index prefix: _[2], _ [10] */
const SLIDE_HEADER_PREFIX = /^_\s*\[\s*\d+\s*\]\s*/;

/** Standalone topic line — heading only, no trailing prose. */
const STANDALONE_MAJOR_HEADING =
  /^(?:_\s*\[\s*\d+\s*\]\s*)?(?:\d+[\.\)]\s*)?(?:개요|전신마취(?:제)?|수면제|항뇌전증(?:제)?|마약(?:성)?진통(?:제)?|항파킨슨(?:병)?(?:제)?|파킨슨(?:병)?(?:제)?|알츠하이머(?:병)?(?:치료제)?|항정신(?:병)?(?:제)?|항불안(?:제)?|기분장애(?:치료제)?|중추신경자극(?:제)?)\s*(?:[_\[\]\d\s]*)?$/;

const SECTION_KEYWORDS =
  /개요|전신마취|수면제|항뇌전증|마약(?:성)?진통|파킨슨|알츠하이머|항정신|항불안|기분장애|중추신경자극/g;

const MIN_SECTION_CHARS = 120;
const MAX_HEADER_LINE_CHARS = 48;

function sectionTitleFromBody(body: string): string {
  const first = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return first ? normalizeIngestDisplayTitle(first) : "";
}

function isRealSectionHeader(line: string, atChunkStart: boolean): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > MAX_HEADER_LINE_CHARS) return false;

  if (SLIDE_HEADER_PREFIX.test(t) && MAJOR_SECTION_HEADING.test(t)) {
    return true;
  }

  if (atChunkStart && STANDALONE_MAJOR_HEADING.test(t)) {
    return true;
  }

  return false;
}

/**
 * Split a multi-page PDF text block at major pharmacology section headings
 * so each topic (개요, 전신마취제, …) can become its own lesson.
 */
export function splitBodyOnMajorSectionHeadings(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join("\n").trim();
    if (joined.length >= MIN_SECTION_CHARS) sections.push(joined);
    current = [];
  };

  for (const line of lines) {
    const atChunkStart = current.join("\n").trim().length === 0;
    const isSectionStart = isRealSectionHeader(line, atChunkStart);

    if (
      isSectionStart &&
      current.join("\n").trim().length >= MIN_SECTION_CHARS
    ) {
      flush();
    }
    current.push(line);
  }
  flush();

  const deduped = dedupeMajorSectionChunks(
    sections.length <= 1 ? [body.trim()].filter((s) => s.length > 0) : sections
  );
  if (deduped.length <= 1) return deduped;
  return deduped;
}

/** Merge consecutive sections that share the same normalized section title. */
export function dedupeMajorSectionChunks(sections: string[]): string[] {
  if (sections.length <= 1) return sections;

  const out: string[] = [];
  for (const section of sections) {
    const title = sectionTitleFromBody(section);
    const prev = out[out.length - 1];
    if (prev && title.length > 0 && title === sectionTitleFromBody(prev)) {
      out[out.length - 1] = `${prev}\n\n${section}`;
      continue;
    }
    out.push(section);
  }
  return out;
}

/** Count distinct major pharmacology topics referenced in chunk titles/text. */
export function countMajorSectionSignals(text: string): number {
  const seen = new Set<string>();
  const re = new RegExp(SECTION_KEYWORDS.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    seen.add(m[0]!);
  }
  return seen.size;
}

export function isDenseSectionedPharmacologyDeck(
  chunkSummaries: { title: string }[]
): boolean {
  const blob = chunkSummaries.map((c) => c.title).join(" ");
  return (
    countMajorSectionSignals(blob) >= 6 ||
    (chunkSummaries.length >= 10 &&
      /중추신경|약리|마취|뇌전증|진통/i.test(blob))
  );
}
