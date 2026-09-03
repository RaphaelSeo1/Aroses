/**
 * Detect when new live-note markdown is the same topic as an existing
 * section, and keep only the incoming lines that aren't already there.
 */

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "have",
  "not",
  "but",
  "you",
  "our",
  "your",
  "just",
  "also",
  "more",
  "some",
  "any",
  "how",
  "why",
  "what",
  "when",
]);

export function extractNoteHeading(markdown: string): string | null {
  const hit = markdown.match(/^#{1,3}\s+(.+)$/m);
  const heading = hit?.[1]?.trim();
  return heading ? heading : null;
}

export function normalizeNoteHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(t: string): string {
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .map(stemToken);
}

/** Same topic by exact/normalized heading, containment, or token overlap. */
export function headingsReferToSameTopic(a: string, b: string): boolean {
  const na = normalizeNoteHeading(a);
  const nb = normalizeNoteHeading(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(tokenize(na));
  const tb = tokenize(nb);
  if (ta.size === 0 || tb.length === 0) return false;
  let overlap = 0;
  for (const t of tb) {
    if (ta.has(t)) overlap += 1;
  }
  const minLen = Math.min(ta.size, tb.length);
  return overlap >= Math.min(2, minLen) && overlap / minLen >= 0.5;
}

export function matchHeadingToSections<
  T extends { sectionId: string; markdown: string },
>(markdownOrHeading: string, sections: T[]): T | null {
  const extracted = extractNoteHeading(markdownOrHeading);
  const first = markdownOrHeading.trim().split("\n")[0] ?? "";
  const incoming = (
    extracted ??
    (/^#{1,3}\s+/.test(first) ? first.replace(/^#{1,3}\s+/, "") : "")
  ).trim();
  if (!incoming) return null;
  for (const section of sections) {
    const heading = extractNoteHeading(section.markdown);
    if (heading && headingsReferToSameTopic(heading, incoming)) {
      return section;
    }
  }
  return null;
}

/**
 * Where chat "add this to the notes" should land.
 * Matching heading → that section. No heading → the section they are looking
 * at (or the latest). A heading that matches nothing is a new topic.
 */
export function pickNoteFoldTarget<
  T extends { sectionId: string; markdown: string },
>(
  incomingMd: string,
  sections: T[],
  preferredSectionId?: string
): T | null {
  if (sections.length === 0) return null;
  const headingHit = matchHeadingToSections(incomingMd, sections);
  if (headingHit) return headingHit;
  if (extractNoteHeading(incomingMd)) return null;
  if (preferredSectionId) {
    const preferred = sections.find((s) => s.sectionId === preferredSectionId);
    if (preferred) return preferred;
  }
  return sections[sections.length - 1] ?? null;
}

function lineTokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = tokenize(b);
  if (ta.size === 0 && tb.length === 0) return 1;
  if (ta.size === 0 || tb.length === 0) return 0;
  let overlap = 0;
  for (const t of tb) {
    if (ta.has(t)) overlap += 1;
  }
  return overlap / Math.max(ta.size, tb.length);
}

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

/**
 * Incoming line is a precise correction of an existing line (same gist,
 * different number/token) — not a brand-new bullet.
 */
export function isCorrectedNoteLine(existing: string, incoming: string): boolean {
  const na = normalizeLine(existing);
  const nb = normalizeLine(incoming);
  if (!na || !nb || na === nb) return false;
  if (isTableLine(existing) || isTableLine(incoming)) {
    return lineTokenOverlap(na, nb) >= 0.5;
  }
  const overlap = lineTokenOverlap(na, nb);
  const numsA = (na.match(/\d+(?:\.\d+)?/g) ?? []).join(",");
  const numsB = (nb.match(/\d+(?:\.\d+)?/g) ?? []).join(",");
  if (numsA !== numsB) {
    const restA = na.replace(/\d+(?:\.\d+)?/g, " ").replace(/\s+/g, " ").trim();
    const restB = nb.replace(/\d+(?:\.\d+)?/g, " ").replace(/\s+/g, " ").trim();
    const restOverlap = lineTokenOverlap(restA, restB);
    if (restOverlap >= 0.75 || restA === restB) return true;
    return false;
  }
  return (
    overlap >= 0.68 &&
    Math.abs(na.length - nb.length) < Math.max(na.length, nb.length) * 0.45
  );
}

export type SurgicalNoteRevision = {
  markdown: string;
  /** True when at least one existing body line was rewritten in place. */
  patched: boolean;
  extraMarkdown: string;
};

/**
 * Fold a @@revise body into the section that is already on the page.
 * Never drops existing bullets just because the model re-emitted a shorter
 * rewrite — keep them, replace only near-duplicate corrections, append
 * genuinely new lines.
 */
export function applySurgicalNoteRevision(
  existingMd: string,
  incomingMd: string
): SurgicalNoteRevision {
  const existing = existingMd.replace(/\s+$/, "");
  const incoming = incomingMd.trim();
  if (!incoming) {
    return { markdown: existing, patched: false, extraMarkdown: "" };
  }

  const existingLines = existing.split("\n");
  const incomingLines = incoming.split("\n");
  const result = [...existingLines];
  const usedIncoming = new Set<number>();
  let patched = false;

  for (let i = 0; i < incomingLines.length; i++) {
    const line = incomingLines[i]!;
    if (/^#{1,3}\s/.test(line) || isTableLine(line)) continue;
    const n = normalizeLine(line);
    if (n.length < 8) continue;
    for (let j = 0; j < result.length; j++) {
      const prev = result[j]!;
      if (/^#{1,3}\s/.test(prev) || isTableLine(prev)) continue;
      if (isCorrectedNoteLine(prev, line)) {
        result[j] = line;
        usedIncoming.add(i);
        patched = true;
        break;
      }
    }
  }

  const mergedSoFar = result.join("\n");
  const extraParts: string[] = [];
  for (let i = 0; i < incomingLines.length; i++) {
    if (usedIncoming.has(i)) continue;
    extraParts.push(incomingLines[i]!);
  }
  const extraMarkdown = uniqueIncomingNoteLines(
    mergedSoFar,
    extraParts.join("\n")
  );
  const markdown = extraMarkdown
    ? `${mergedSoFar.trimEnd()}\n${extraMarkdown}`
    : mergedSoFar;

  return { markdown, patched, extraMarkdown };
}

function normalizeLine(line: string): string {
  return line
    .replace(/^#{1,3}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Body lines from `incomingMd` that are not already in `existingMd`
 * (heading stripped). Empty when the incoming notes are a restatement.
 */
export function uniqueIncomingNoteLines(
  existingMd: string,
  incomingMd: string
): string {
  const existingNorm = new Set(
    existingMd
      .split("\n")
      .map(normalizeLine)
      .filter((n) => n.length >= 8)
  );
  const extra: string[] = [];
  for (const line of incomingMd.split("\n")) {
    if (/^#{1,3}\s/.test(line)) continue;
    const n = normalizeLine(line);
    if (!n) {
      if (extra.length > 0 && extra[extra.length - 1] !== "") extra.push("");
      continue;
    }
    if (n.length < 8) {
      extra.push(line);
      continue;
    }
    if (existingNorm.has(n)) continue;
    let dup = false;
    for (const e of existingNorm) {
      if (e.includes(n) || n.includes(e)) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    extra.push(line);
    existingNorm.add(n);
  }
  return extra.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
