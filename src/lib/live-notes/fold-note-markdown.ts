/**
 * Detect when new live-note markdown is the same topic as an existing
 * section, and keep only the incoming lines that aren't already there.
 * Also: placement-aware inserts, line-level dedupe, delete matching, and
 * append chunk classification for the live pump.
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

/** Marker stored in transcript excerpts for slide-seeded sections. */
export const DECK_PAGES_EXCERPT_RE =
  /\[drafted from uploaded slides(?:;\s*pages?\s+(\d+)(?:\s*[-–—]\s*(\d+))?)?\]/i;

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

export function extractBoldTerms(markdown: string): string[] {
  const terms: string[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const t = m[1]!.trim();
    if (t) terms.push(t);
  }
  return terms;
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
  // Need at least two content tokens on each side so "Topic A" ≠ "Topic B".
  if (ta.size < 2 || tb.length < 2) return false;
  let overlap = 0;
  for (const t of tb) {
    if (ta.has(t)) overlap += 1;
  }
  const minLen = Math.min(ta.size, tb.length);
  return overlap >= 2 && overlap / minLen >= 0.5;
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
 * Token/term overlap of bold terms + bullets between two note bodies.
 * Used when a heading alone is ambiguous.
 */
export function sectionBodySimilarity(a: string, b: string): number {
  const boldA = new Set(tokenize(extractBoldTerms(a).join(" ")));
  const boldB = tokenize(extractBoldTerms(b).join(" "));
  let boldOverlap = 0;
  for (const t of boldB) {
    if (boldA.has(t)) boldOverlap += 1;
  }
  const boldScore =
    boldA.size === 0 && boldB.length === 0
      ? 0
      : boldOverlap / Math.max(boldA.size, boldB.length, 1);

  const bulletsA = a
    .split("\n")
    .filter((l) => /^[-*]\s|^\d+\.\s/.test(l.trim()))
    .map(normalizeLine)
    .filter((n) => n.length >= 8);
  const bulletsB = b
    .split("\n")
    .filter((l) => /^[-*]\s|^\d+\.\s/.test(l.trim()))
    .map(normalizeLine)
    .filter((n) => n.length >= 8);
  if (bulletsA.length === 0 && bulletsB.length === 0) {
    return lineTokenOverlap(a, b) * 0.5 + boldScore * 0.5;
  }
  let hits = 0;
  for (const bb of bulletsB) {
    for (const aa of bulletsA) {
      if (aa === bb || aa.includes(bb) || bb.includes(aa) || lineTokenOverlap(aa, bb) >= 0.62) {
        hits += 1;
        break;
      }
    }
  }
  const bulletScore = hits / Math.max(bulletsB.length, 1);
  return boldScore * 0.35 + bulletScore * 0.65;
}

/** Threshold tuned by tests — body must clearly restate an existing section. */
export const BODY_SIMILARITY_MATCH_THRESHOLD = 0.42;

/**
 * Match a chunk by heading first, then by body similarity when the heading
 * is missing or ambiguous.
 */
export function matchChunkToSections<
  T extends { sectionId: string; markdown: string },
>(chunk: string, sections: T[]): T | null {
  const byHeading = matchHeadingToSections(chunk, sections);
  if (byHeading) return byHeading;
  if (sections.length === 0) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const section of sections) {
    const score = sectionBodySimilarity(section.markdown, chunk);
    if (score > bestScore) {
      bestScore = score;
      best = section;
    }
  }
  if (best && bestScore >= BODY_SIMILARITY_MATCH_THRESHOLD) return best;
  return null;
}

/** Split an @@append body on top-level `## ` boundaries (keeps the heading). */
export function splitAppendIntoChunks(markdown: string): string[] {
  const text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^##\s+/.test(line) && cur.length > 0) {
      chunks.push(cur.join("\n").trim());
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length > 0) chunks.push(cur.join("\n").trim());
  return chunks.filter(Boolean);
}

export type AppendChunkAction =
  | { kind: "fold"; sectionId: string; markdown: string }
  | { kind: "new"; markdown: string };

/**
 * Classify each `## ` chunk of an append: fold into a matching section or
 * create a new one. Headless chunks go to the most recent matched section.
 */
export function classifyAppendChunks<
  T extends { sectionId: string; markdown: string },
>(
  appendMarkdown: string,
  sections: T[],
  preferredSectionId?: string | null
): AppendChunkAction[] {
  const chunks = splitAppendIntoChunks(appendMarkdown);
  if (chunks.length === 0) return [];
  const actions: AppendChunkAction[] = [];
  let lastFoldId: string | null = preferredSectionId ?? null;

  for (const chunk of chunks) {
    const hasHeading = /^##\s+/m.test(chunk.trim());
    if (!hasHeading) {
      const target =
        lastFoldId ??
        preferredSectionId ??
        (sections.length > 0 ? sections[sections.length - 1]!.sectionId : null);
      if (target) {
        actions.push({ kind: "fold", sectionId: target, markdown: chunk });
        lastFoldId = target;
      } else {
        // No existing section to attach to — emit as new (pump will add heading).
        actions.push({ kind: "new", markdown: chunk });
      }
      continue;
    }
    const match = matchChunkToSections(chunk, sections);
    if (match) {
      actions.push({ kind: "fold", sectionId: match.sectionId, markdown: chunk });
      lastFoldId = match.sectionId;
    } else {
      actions.push({ kind: "new", markdown: chunk });
    }
  }
  return actions;
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

function bulletDepth(line: string): number {
  if (/^\s{2,}[-*]\s/.test(line)) return 1;
  if (/^[-*]\s/.test(line)) return 0;
  return -1;
}

function isParentCandidate(line: string): boolean {
  if (/^###\s+/.test(line)) return true;
  return bulletDepth(line) === 0;
}

function lineRichness(line: string): number {
  const bold = extractBoldTerms(line).length;
  return normalizeLine(line).length + bold * 12;
}

/**
 * Insert incoming lines under the best-matching existing parent bullet or
 * `### ` subheading (term overlap). Nested incoming bullets travel with their
 * parent. Falls back to appending at the end when nothing matches.
 */
export function placeIncomingNoteLines(
  existingMd: string,
  incomingMd: string
): string {
  const existing = existingMd.replace(/\s+$/, "");
  const unique = uniqueIncomingNoteLines(existing, incomingMd);
  if (!unique) return existing;

  const result = existing.split("\n");
  const incomingLines = unique.split("\n");
  let i = 0;
  while (i < incomingLines.length) {
    const line = incomingLines[i]!;
    const depth = bulletDepth(line);
    const group: string[] = [line];
    i += 1;
    // Nested children travel with their parent.
    while (i < incomingLines.length) {
      const next = incomingLines[i]!;
      const nd = bulletDepth(next);
      if (depth === 0 && nd === 1) {
        group.push(next);
        i += 1;
        continue;
      }
      if (depth < 0 && (nd === 0 || nd === 1 || /^###\s+/.test(next))) break;
      if (depth === 0 && (nd === 0 || /^###\s+/.test(next) || /^##\s+/.test(next))) {
        break;
      }
      if (depth < 0 && next.trim() === "") {
        group.push(next);
        i += 1;
        continue;
      }
      if (depth < 0) {
        group.push(next);
        i += 1;
        continue;
      }
      break;
    }

    // Find best parent among existing top-level bullets / ### headings.
    let bestIdx = -1;
    let bestScore = 0;
    const probe = normalizeLine(group[0]!);
    for (let j = 0; j < result.length; j++) {
      const cand = result[j]!;
      if (!isParentCandidate(cand)) continue;
      const score = lineTokenOverlap(normalizeLine(cand), probe);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    const looksLikeNestedDetail = depth === 1;
    if (bestIdx >= 0 && bestScore >= 0.28 && looksLikeNestedDetail) {
      let insertAt = bestIdx + 1;
      while (insertAt < result.length && bulletDepth(result[insertAt]!) === 1) {
        insertAt += 1;
      }
      result.splice(insertAt, 0, ...group);
    } else if (
      bestIdx >= 0 &&
      bestScore >= 0.5 &&
      depth === 0 &&
      // Strong match to an existing parent lead-in → nest as a child detail.
      probe.split(" ").length <= 14
    ) {
      let insertAt = bestIdx + 1;
      while (insertAt < result.length && bulletDepth(result[insertAt]!) === 1) {
        insertAt += 1;
      }
      const nested = group.map((g, idx) => {
        if (idx === 0 && bulletDepth(g) === 0) {
          return `  - ${g.replace(/^[-*]\s+/, "")}`;
        }
        return g;
      });
      result.splice(insertAt, 0, ...nested);
    } else {
      result.push(...group);
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Fold a @@revise body into the section that is already on the page.
 * Never drops existing bullets just because the model re-emitted a shorter
 * rewrite — keep them, replace only near-duplicate corrections, append
 * genuinely new lines under the best parent when possible.
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
    ? placeIncomingNoteLines(mergedSoFar, extraMarkdown)
    : mergedSoFar;

  // extraMarkdown is still the unique fragment (for extension typewriter path).
  const placedExtra = extraMarkdown
    ? (() => {
        const before = new Set(mergedSoFar.split("\n"));
        return markdown
          .split("\n")
          .filter((l) => !before.has(l))
          .join("\n")
          .trim();
      })()
    : "";

  return {
    markdown: dedupeSectionLines(markdown),
    patched,
    extraMarkdown: placedExtra || extraMarkdown,
  };
}

export function normalizeLine(line: string): string {
  return line
    .replace(/^#{1,3}\s+/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
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
    // Drop a repeated document/section heading, but preserve H3 subtopics
    // that organize an enrichment inside the existing H2 section.
    if (/^#{1,2}\s/.test(line)) continue;
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
      if (e.includes(n) || n.includes(e) || lineTokenOverlap(e, n) >= 0.75) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    extra.push(line);
    existingNorm.add(n);
  }
  return extra.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

const LINE_DEDUPE_SIMILARITY = 0.78;

/**
 * Normalize-and-dedupe lines inside a section. Keeps the richer line
 * (longer / more bold terms). Callers must only run this on AI-owned
 * sections — student provenance is never passed in.
 */
export function dedupeSectionLines(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  const keptNorm: string[] = [];

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) || isTableLine(line) || !line.trim()) {
      kept.push(line);
      keptNorm.push("");
      continue;
    }
    const n = normalizeLine(line);
    if (n.length < 8) {
      kept.push(line);
      keptNorm.push(n);
      continue;
    }
    let dupIdx = -1;
    for (let i = 0; i < keptNorm.length; i++) {
      const prev = keptNorm[i]!;
      if (!prev || prev.length < 8) continue;
      if (
        prev === n ||
        prev.includes(n) ||
        n.includes(prev) ||
        lineTokenOverlap(prev, n) >= LINE_DEDUPE_SIMILARITY
      ) {
        dupIdx = i;
        break;
      }
    }
    if (dupIdx < 0) {
      kept.push(line);
      keptNorm.push(n);
      continue;
    }
    // Keep the richer line.
    if (lineRichness(line) > lineRichness(kept[dupIdx]!)) {
      kept[dupIdx] = line;
      keptNorm[dupIdx] = n;
    }
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Remove lines from a section that exactly match (after normalization) any
 * line in `deleteBody`. Returns the new markdown (may be heading-only).
 */
export function deleteExactNoteLines(
  existingMd: string,
  deleteBody: string
): string {
  const targets = new Set(
    deleteBody
      .split("\n")
      .map(normalizeLine)
      .filter((n) => n.length >= 6)
  );
  if (targets.size === 0) return existingMd;
  const kept = existingMd.split("\n").filter((line) => {
    if (/^#{1,2}\s/.test(line)) return true;
    const n = normalizeLine(line);
    if (!n) return true;
    return !targets.has(n);
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** Compact outline line for prompts: `[id] heading — top bold terms`. */
export function formatSectionOutlineEntry(section: {
  sectionId: string;
  markdown: string;
}): string {
  const heading = extractNoteHeading(section.markdown) ?? "(untitled)";
  const bold = extractBoldTerms(section.markdown).slice(0, 6);
  const preview = section.markdown
    .split("\n")
    .filter((l) => l.trim() && !/^#{1,3}\s/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const terms = bold.length > 0 ? bold.map((t) => `**${t}**`).join(", ") : preview;
  return `[${section.sectionId}] ${heading}${terms ? ` — ${terms}` : ""}`;
}

export function buildSectionsOutline(
  sections: Array<{ sectionId: string; markdown: string }>
): string {
  return sections.map(formatSectionOutlineEntry).join("\n");
}

/**
 * Generic recap/outline/agenda detector — restates earlier headings or is
 * titled like a review/outline. Not tied to any lecture subject.
 */
export function looksLikeRecapOrOutlineSlide(
  title: string,
  body: string,
  existingHeadings: string[]
): boolean {
  const titleNorm = normalizeNoteHeading(title);
  const reviewTitle =
    /\b(recap|review|summary|overview|outline|agenda|key concepts?|reference only|takeaways?|looking ahead|objectives?)\b/i.test(
      title
    ) ||
    /\b(recap|review|summary|outline|agenda|key concepts?|reference only)\b/i.test(
      titleNorm
    );
  if (!reviewTitle && existingHeadings.length === 0) return false;

  const bodyHeadish = [title, ...body.split("\n").map((l) => l.trim())]
    .filter(Boolean)
    .slice(0, 40);
  let restated = 0;
  for (const existing of existingHeadings) {
    for (const line of bodyHeadish) {
      const cleaned = line.replace(/^[-*#\d.]+\s*/, "");
      if (headingsReferToSameTopic(existing, cleaned)) {
        restated += 1;
        break;
      }
    }
  }
  if (reviewTitle && (existingHeadings.length === 0 || restated >= 1)) {
    return true;
  }
  if (
    existingHeadings.length >= 2 &&
    restated >= Math.min(2, existingHeadings.length)
  ) {
    return true;
  }
  return false;
}

export function formatDeckDraftExcerpt(
  pageFrom?: number,
  pageTo?: number
): string {
  if (
    typeof pageFrom === "number" &&
    typeof pageTo === "number" &&
    pageFrom > 0 &&
    pageTo >= pageFrom
  ) {
    return pageFrom === pageTo
      ? `[drafted from uploaded slides; pages ${pageFrom}]`
      : `[drafted from uploaded slides; pages ${pageFrom}-${pageTo}]`;
  }
  return "[drafted from uploaded slides]";
}

export function parseDeckPageRange(
  excerpt: string | undefined | null
): { from: number; to: number } | null {
  if (!excerpt) return null;
  const m = excerpt.match(DECK_PAGES_EXCERPT_RE);
  if (!m) {
    if (/\[drafted from uploaded slides\]/i.test(excerpt)) return null;
    return null;
  }
  const from = m[1] ? Number(m[1]) : NaN;
  const to = m[2] ? Number(m[2]) : from;
  if (!Number.isFinite(from) || from < 1) return null;
  return { from, to: Number.isFinite(to) && to >= from ? to : from };
}

/** Sections whose seed page range overlaps any of the given deck page nums. */
export function sectionsOverlappingDeckPages<
  T extends { sectionId: string },
>(
  sections: T[],
  pageNums: number[],
  excerptById: Map<string, string> | Record<string, string>
): T[] {
  if (pageNums.length === 0) return [];
  const pages = new Set(pageNums);
  const get =
    excerptById instanceof Map
      ? (id: string) => excerptById.get(id)
      : (id: string) => excerptById[id];
  return sections.filter((s) => {
    const range = parseDeckPageRange(get(s.sectionId));
    if (!range) return false;
    for (let p = range.from; p <= range.to; p++) {
      if (pages.has(p)) return true;
    }
    return false;
  });
}

export type NoteSectionRef = { sectionId: string; markdown: string };

/**
 * Deterministic duplicate topic groups (document order). Earliest id is kept.
 */
export function findDuplicateTopicGroups(
  sections: NoteSectionRef[]
): Array<{ keep: NoteSectionRef; absorb: NoteSectionRef[] }> {
  const used = new Set<string>();
  const groups: Array<{ keep: NoteSectionRef; absorb: NoteSectionRef[] }> = [];
  for (let i = 0; i < sections.length; i++) {
    const a = sections[i]!;
    if (used.has(a.sectionId)) continue;
    const ha = extractNoteHeading(a.markdown);
    if (!ha) continue;
    const absorb: NoteSectionRef[] = [];
    for (let j = i + 1; j < sections.length; j++) {
      const b = sections[j]!;
      if (used.has(b.sectionId)) continue;
      const hb = extractNoteHeading(b.markdown);
      if (!hb) continue;
      const headingMatch = headingsReferToSameTopic(ha, hb);
      const bodyScore = sectionBodySimilarity(a.markdown, b.markdown);
      if (headingMatch || bodyScore >= BODY_SIMILARITY_MATCH_THRESHOLD) {
        absorb.push(b);
        used.add(b.sectionId);
      }
    }
    if (absorb.length > 0) {
      used.add(a.sectionId);
      groups.push({ keep: a, absorb });
    }
  }
  return groups;
}

/** Union unique lines into the earliest section; drop absorbed ids. */
export function mergeDuplicateGroup(group: {
  keep: NoteSectionRef;
  absorb: NoteSectionRef[];
}): { sectionId: string; markdown: string; removeSectionIds: string[] } {
  let md = group.keep.markdown;
  for (const other of group.absorb) {
    md = placeIncomingNoteLines(md, other.markdown);
  }
  return {
    sectionId: group.keep.sectionId,
    markdown: dedupeSectionLines(md),
    removeSectionIds: group.absorb.map((s) => s.sectionId),
  };
}

/**
 * Invariant: each topic (by heading sameness) appears in exactly one section.
 * Throws AssertionError-style Error with detail when violated.
 */
export function assertNoDuplicateTopics(doc: NoteSectionRef[]): void {
  for (let i = 0; i < doc.length; i++) {
    const a = doc[i]!;
    const ha = extractNoteHeading(a.markdown);
    if (!ha) continue;
    for (let j = i + 1; j < doc.length; j++) {
      const b = doc[j]!;
      const hb = extractNoteHeading(b.markdown);
      if (!hb) continue;
      if (headingsReferToSameTopic(ha, hb)) {
        throw new Error(
          `Duplicate topic sections: "${ha}" (${a.sectionId}) and "${hb}" (${b.sectionId})`
        );
      }
    }
  }
}

/**
 * Apply append-chunk classification to an in-memory doc (for tests and
 * headless fold simulation). Returns the updated section list.
 */
export function applyAppendChunkActions(
  sections: NoteSectionRef[],
  appendMarkdown: string,
  newSectionId: string
): NoteSectionRef[] {
  const actions = classifyAppendChunks(appendMarkdown, sections);
  const next = sections.map((s) => ({ ...s }));
  let created = false;
  for (const action of actions) {
    if (action.kind === "fold") {
      const idx = next.findIndex((s) => s.sectionId === action.sectionId);
      if (idx < 0) continue;
      const surgical = applySurgicalNoteRevision(next[idx]!.markdown, action.markdown);
      next[idx] = {
        ...next[idx]!,
        markdown: surgical.markdown,
      };
    } else {
      const id = created ? `${newSectionId}-${next.length}` : newSectionId;
      created = true;
      next.push({ sectionId: id, markdown: action.markdown });
    }
  }
  return next;
}
