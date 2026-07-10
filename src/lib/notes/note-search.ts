import type { NoteDocCardData } from "@/lib/notes/hub-types";

/** Plain text used for keyword search (title + body). Cap keeps payloads small. */
export function buildNoteSearchText(
  title: string,
  body: unknown,
  max = 12_000
): string {
  const bodyText =
    typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
  const combined = `${title} ${bodyText}`.replace(/\s+/g, " ").trim();
  return combined.length > max ? combined.slice(0, max) : combined;
}

export type NoteSearchHit = {
  card: NoteDocCardData;
  sectionTitle: string;
  /** Short excerpt around the first match, when found in body text. */
  snippet: string | null;
};

function excerptAround(haystack: string, query: string, radius = 56): string | null {
  const lower = haystack.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(haystack.length, idx + q.length + radius);
  let slice = haystack.slice(start, end).trim();
  if (start > 0) slice = `…${slice}`;
  if (end < haystack.length) slice = `${slice}…`;
  return slice;
}

export function searchNoteCards(
  items: { card: NoteDocCardData; sectionTitle: string }[],
  rawQuery: string
): NoteSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const hits: NoteSearchHit[] = [];
  for (const item of items) {
    const { card, sectionTitle } = item;
    const title = card.title.toLowerCase();
    const subtitle = (card.subtitle ?? "").toLowerCase();
    const body = (card.searchText ?? card.preview ?? "").toLowerCase();
    if (
      !title.includes(query) &&
      !subtitle.includes(query) &&
      !body.includes(query)
    ) {
      continue;
    }
    const snippetSource = card.searchText ?? card.preview ?? "";
    const snippet =
      excerptAround(snippetSource, query) ??
      (card.preview?.trim() ? card.preview : null);
    hits.push({ card, sectionTitle, snippet });
  }
  return hits;
}
