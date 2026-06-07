/**
 * Parse page locators from ingest chunk `position` strings.
 * Chunks use `page 3` or `pages 17–18` (en dash or hyphen).
 */

export function parsePageNumbersFromPosition(position: string): number[] {
  const range = position.match(/\bpages?\s+(\d+)\s*[–-]\s*(\d+)\b/i);
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

  const single = position.match(/\bpage\s+(\d+)\b/i);
  if (single) {
    const n = Number.parseInt(single[1]!, 10);
    return Number.isFinite(n) ? [n] : [];
  }

  return [];
}

export function parseFirstPageFromPosition(position: string): number | null {
  const pages = parsePageNumbersFromPosition(position);
  return pages[0] ?? null;
}
