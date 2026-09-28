/**
 * Figure markers the writer puts in lesson text: `[[F3: caption]]` on its own
 * line after the paragraph it illustrates. Client-safe (no Node imports).
 */

const MARKER_RE = /\[\[\s*(F\d{1,4})\s*(?::\s*([^\]\n]*))?\]\]/g;

export type FigureMarker = {
  id: string;
  caption: string;
  /** Paragraphs of the cleaned text that come before the marker. */
  afterParagraph: number;
};

/** Removes markers, including a half-streamed one at the very end. */
export function stripFigureMarkers(text: string): string {
  return text
    .replace(MARKER_RE, "")
    .replace(/\[\[[^\]\n]*\]?$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Figures the course builder placed. Older ingest pipelines also left
 * `visual_assets` on lessons, but those were never shown in reading mode.
 */
export function builderFigures<T extends { imageUrl: string }>(assets: T[] | undefined): T[] {
  return (assets ?? []).filter((a) => a.imageUrl.includes("/course-build/"));
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Pulls markers out of lesson text and records where each one sat. */
export function extractFigureMarkers(text: string): { text: string; markers: FigureMarker[] } {
  const markers: FigureMarker[] = [];
  const kept: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const found = [...block.matchAll(MARKER_RE)];
    const rest = block.replace(MARKER_RE, "").replace(/[ \t]+\n/g, "\n").trim();
    if (rest) kept.push(rest);
    for (const m of found) {
      markers.push({ id: m[1].toUpperCase(), caption: (m[2] ?? "").trim(), afterParagraph: kept.length });
    }
  }
  return { text: kept.join("\n\n"), markers };
}
