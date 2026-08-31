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
>(firstLine: string, sections: T[]): T | null {
  const incoming = firstLine.replace(/^#{1,3}\s+/, "").trim();
  if (!incoming) return null;
  for (const section of sections) {
    const heading = extractNoteHeading(section.markdown);
    if (heading && headingsReferToSameTopic(heading, incoming)) {
      return section;
    }
  }
  return null;
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
