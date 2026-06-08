/**
 * Parse page locators from ingest chunk `position` strings.
 * Chunks use `page 3` or `pages 17–18` (en dash or hyphen).
 * Section suffixes (`pages 1–5 §2`) are stripped before parsing.
 */

function stripSectionSuffix(position: string): string {
  return position.replace(/\s*§\d+\s*$/i, "").trim();
}

export function parsePageNumbersFromPosition(position: string): number[] {
  const pos = stripSectionSuffix(position);
  const range = pos.match(/\bpages?\s+(\d+)\s*[–-]\s*(\d+)\b/i);
  if (range) {
    const start = Number.parseInt(range[1]!, 10);
    const end = Number.parseInt(range[2]!, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const pages: number[] = [];
    for (let p = lo; p <= hi; p++) pages.push(p);
    return pages;
  }

  const single = pos.match(/\bpage\s+(\d+)\b/i);
  if (single) {
    const n = Number.parseInt(single[1]!, 10);
    return Number.isFinite(n) ? [n] : [];
  }

  return [];
}

export function parseSlideNumbersFromPosition(position: string): number[] {
  const pos = stripSectionSuffix(position);
  const m = pos.match(/\bslide\s+(\d+)\b/i);
  if (!m) return [];
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? [n] : [];
}

export function parseFirstPageFromPosition(position: string): number | null {
  const pages = parsePageNumbersFromPosition(position);
  return pages[0] ?? null;
}

/** Pages covered by a structure-plan lesson via its source chunk ids. */
export function pagesForPlanLesson(
  planLesson: { source_chunk_ids: string[] } | undefined,
  chunksById: Map<string, { position: string }>
): Set<number> {
  const pages = new Set<number>();
  if (!planLesson) return pages;
  for (const id of planLesson.source_chunk_ids) {
    const chunk = chunksById.get(id);
    if (!chunk) continue;
    for (const p of parsePageNumbersFromPosition(chunk.position)) {
      pages.add(p);
    }
  }
  return pages;
}

/** True when a table's source page falls within the lesson's page set. */
export function tablePageOverlapsLesson(
  tablePage: number,
  lessonPages: Set<number>
): boolean {
  if (lessonPages.size === 0) return false;
  return lessonPages.has(tablePage);
}
