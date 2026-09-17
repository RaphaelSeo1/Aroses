/**
 * Lightweight, subject-neutral "what do the notes already establish" map.
 *
 * Generated notes are produced in chunks (transcript slices, slide batches,
 * lesson chunks). Each chunk-writer only sees a small window of the document,
 * so it tends to re-define / re-explain concepts that an earlier section
 * already covered. This module derives a compact CONCEPT STATE from the
 * current document — purely from markdown structure, no model call — so a
 * later generation step can tell the difference between:
 *
 *   - a concept being MENTIONED again (fine),
 *   - a concept being EXPLAINED again (redundant), and
 *   - a concept receiving genuinely NEW information (keep).
 *
 * Concept candidates are the document's own **bold** lead-ins and headings.
 * Nothing here is tied to a subject, lecture, or vocabulary list.
 */

import {
  extractBoldTerms,
  extractNoteHeading,
  lineTokenOverlap,
  normalizeLine,
  tokenizeNoteText,
} from "@/lib/live-notes/fold-note-markdown";

export type ConceptState = "defined" | "explained" | "mentioned";

export type ConceptEntry = {
  /** Display label (first-seen bold form, trailing punctuation stripped). */
  label: string;
  /** Normalized identity used to merge spellings/plurals. */
  key: string;
  /** Best (strongest) state reached anywhere in the document. */
  state: ConceptState;
  /** Section that owns the explanation (earliest defined/explained; else first mention). */
  ownerSectionId: string;
  ownerHeading: string;
  /** Up to three short facts the owner section already states about the concept. */
  facts: string[];
  /** Every section id that mentions the concept, document order. */
  mentionedIn: string[];
  /** Document order of the owner section (for recency ranking). */
  ownerIndex: number;
};

export type ConceptCoverage = {
  concepts: ConceptEntry[];
  /** `**Open question:**` lines anywhere in the doc — unresolved items. */
  openQuestions: Array<{ sectionId: string; text: string }>;
};

export type NoteSectionLike = { sectionId: string; markdown: string };

/**
 * Structural labels our own note conventions produce. They are not subject
 * concepts and must never be tracked as "already explained" topics.
 */
const STRUCTURAL_LABEL_RE =
  /^(why it matters|open question|remember(?: this)?|takeaways?|summary|key terms?|key vocabulary|self[- ]check|example|examples|note|notes|definition|overview|recap|term|terms)$/i;

const DEFINITION_CUE_RE =
  /\b(?:is|are|refers? to|means?|denotes?|defined as|describes?|consists? of|the process (?:by which|of)|the (?:set|sum|ratio|number|amount|rate|force|study|practice|act|state|ability|tendency|measure) (?:of|by|that|which))\b/i;

function stripLabel(raw: string): string {
  return raw
    .trim()
    .replace(/[:：\-–—]+\s*$/, "")
    .replace(/^["'“‘(]+|["'”’)]+$/g, "")
    .trim();
}

/** Normalized concept identity: lowercase content tokens, joined. */
export function conceptKey(label: string): string {
  const toks = tokenizeNoteText(label);
  if (toks.length === 0) {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  return toks.join(" ");
}

function isStructuralLabel(label: string): boolean {
  return STRUCTURAL_LABEL_RE.test(stripLabel(label));
}

function isSkippableLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^\|/.test(t)) return true;
  if (/^>\s*\(AI\)/i.test(t)) return true;
  return false;
}

/** Does this line contain the concept (as a whole-token phrase)? */
export function lineMentionsConcept(line: string, key: string): boolean {
  if (!key) return false;
  const lineToks = tokenizeNoteText(normalizeLine(line));
  const keyToks = key.split(" ");
  if (keyToks.length === 0) return false;
  if (keyToks.length === 1) return lineToks.includes(keyToks[0]!);
  // Multi-word: require every key token to appear (order-insensitive), which
  // tolerates inflection while rejecting unrelated lines.
  const set = new Set(lineToks);
  return keyToks.every((k) => set.has(k));
}

/** Bold lead-in followed by a definition separator or a definition cue. */
export function isDefinitionLine(line: string, label: string): boolean {
  const t = line.trim().replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
  const wanted = conceptKey(label);
  const bold = t.match(/^\*\*([^*]+)\*\*\s*(.*)$/);
  if (bold) {
    const inner = bold[1]!;
    const rest = bold[2]!;
    if (conceptKey(inner) === wanted) {
      if (/[:：\-–—]\s*$/.test(inner)) return true;
      if (/^(?:[:：]|[-–—]|is\b|are\b|refers?\b|means?\b)/i.test(rest)) return true;
    }
  }
  const escaped = stripLabel(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inline = new RegExp(
    `\\b${escaped}(?:s|es)?\\b\\s*(?:\\([^)]*\\))?\\s*(?:${DEFINITION_CUE_RE.source})`,
    "i"
  );
  return inline.test(t.replace(/\*\*/g, ""));
}

function bulletDepth(line: string): number {
  if (/^\s{2,}(?:[-*]|\d+\.)\s/.test(line)) return 1;
  if (/^(?:[-*]|\d+\.)\s/.test(line)) return 0;
  return -1;
}

function readableFact(line: string): string {
  const cleaned = line
    .trim()
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117).trimEnd()}…` : cleaned;
}

type SectionConceptSignal = {
  state: ConceptState;
  facts: string[];
};

/** How strongly one section covers one concept. */
function sectionSignal(
  lines: string[],
  label: string,
  key: string
): SectionConceptSignal | null {
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isSkippableLine(line)) continue;
    if (lineMentionsConcept(line, key)) hits.push(i);
  }
  if (hits.length === 0) return null;

  let defined = false;
  let supportingLines = 0;
  const facts: string[] = [];
  for (const i of hits) {
    const line = lines[i]!;
    const isDef = isDefinitionLine(line, label);
    if (isDef) defined = true;
    const norm = normalizeLine(line);
    if (norm.length >= 40) supportingLines += 1;
    // Nested children under a bullet that names the concept count as explanation.
    if (bulletDepth(line) === 0) {
      let j = i + 1;
      while (j < lines.length && bulletDepth(lines[j]!) === 1) {
        supportingLines += 1;
        j += 1;
      }
    }
    const fact = readableFact(line);
    if (fact.length >= 12) {
      // The definition is the most useful single fact — surface it first.
      if (isDef && !facts.some((f) => f === fact)) facts.unshift(fact);
      else if (facts.length < 3) facts.push(fact);
    }
  }
  facts.splice(3);

  const state: ConceptState = defined
    ? "defined"
    : hits.length >= 2 || supportingLines >= 2
      ? "explained"
      : "mentioned";
  return { state, facts };
}

const STATE_RANK: Record<ConceptState, number> = {
  mentioned: 0,
  explained: 1,
  defined: 2,
};

/**
 * Build the concept coverage map for a document (sections in order).
 * Deterministic, O(sections × concepts × lines) on short note text.
 */
export function extractConceptCoverage(
  sections: NoteSectionLike[]
): ConceptCoverage {
  const byKey = new Map<string, ConceptEntry>();
  const openQuestions: ConceptCoverage["openQuestions"] = [];

  // Pass 1 — collect candidate labels (bold lead-ins + headings) in order.
  const labelsByKey = new Map<string, string>();
  for (const section of sections) {
    const heading = extractNoteHeading(section.markdown);
    const candidates = [...extractBoldTerms(section.markdown)];
    if (heading) candidates.push(heading);
    for (const raw of candidates) {
      const label = stripLabel(raw);
      if (!label || label.length < 3 || label.length > 80) continue;
      if (isStructuralLabel(label)) continue;
      const key = conceptKey(label);
      if (!key || key.length < 3) continue;
      if (!labelsByKey.has(key)) labelsByKey.set(key, label);
    }
    for (const line of section.markdown.split("\n")) {
      const m = line.match(/\*\*open question:\*\*\s*(.+)$/i);
      if (m) {
        openQuestions.push({
          sectionId: section.sectionId,
          text: m[1]!.trim().slice(0, 160),
        });
      }
    }
  }

  // Pass 2 — score each concept per section.
  sections.forEach((section, index) => {
    const lines = section.markdown.replace(/\r\n/g, "\n").split("\n");
    const heading = extractNoteHeading(section.markdown) ?? "(untitled)";
    for (const [key, label] of labelsByKey) {
      const signal = sectionSignal(lines, label, key);
      if (!signal) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          label,
          key,
          state: signal.state,
          ownerSectionId: section.sectionId,
          ownerHeading: heading,
          facts: signal.facts,
          mentionedIn: [section.sectionId],
          ownerIndex: index,
        });
        continue;
      }
      existing.mentionedIn.push(section.sectionId);
      // Ownership moves forward only when a later section reaches a strictly
      // stronger state than anything before it (first real explanation wins).
      if (STATE_RANK[signal.state] > STATE_RANK[existing.state]) {
        existing.state = signal.state;
        existing.ownerSectionId = section.sectionId;
        existing.ownerHeading = heading;
        existing.facts = signal.facts;
        existing.ownerIndex = index;
      }
    }
  });

  return { concepts: [...byKey.values()], openQuestions };
}

function relevanceScore(entry: ConceptEntry, queryToks: Set<string>): number {
  if (queryToks.size === 0) return 0;
  let score = 0;
  for (const k of entry.key.split(" ")) {
    if (queryToks.has(k)) score += 3;
  }
  for (const fact of entry.facts) {
    score += lineTokenOverlap(fact, [...queryToks].join(" ")) * 2;
  }
  return score;
}

const STATE_LABEL: Record<ConceptState, string> = {
  defined: "DEFINED + EXPLAINED",
  explained: "EXPLAINED",
  mentioned: "MENTIONED only (not yet defined)",
};

/**
 * Compact prompt block. Concepts most relevant to `relevanceText` (the
 * incoming slice/chunk) come first, then the most recently owned; the block
 * is hard-capped so context stays bounded on any document length.
 */
export function formatConceptCoverage(
  coverage: ConceptCoverage,
  opts?: {
    relevanceText?: string;
    maxChars?: number;
    maxConcepts?: number;
  }
): string {
  const maxChars = opts?.maxChars ?? 2_200;
  const maxConcepts = opts?.maxConcepts ?? 40;
  if (coverage.concepts.length === 0 && coverage.openQuestions.length === 0) {
    return "";
  }
  const queryToks = new Set(tokenizeNoteText(opts?.relevanceText ?? ""));
  const ranked = [...coverage.concepts]
    .map((c) => ({ c, r: relevanceScore(c, queryToks) }))
    .sort((a, b) => {
      if (b.r !== a.r) return b.r - a.r;
      // Explained/defined concepts matter more than bare mentions.
      const sr = STATE_RANK[b.c.state] - STATE_RANK[a.c.state];
      if (sr !== 0) return sr;
      return b.c.ownerIndex - a.c.ownerIndex;
    })
    .slice(0, maxConcepts);

  const lines: string[] = [];
  let used = 0;
  for (const { c } of ranked) {
    const fact = c.facts[0] ? `: "${c.facts[0]}"` : "";
    const where = `[${c.ownerSectionId}] ${c.ownerHeading}`;
    const also =
      c.mentionedIn.length > 1
        ? ` (also mentioned in ${c.mentionedIn.length - 1} other section${c.mentionedIn.length > 2 ? "s" : ""})`
        : "";
    const line = `- **${c.label}** — ${STATE_LABEL[c.state]} in ${where}${fact}${also}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  for (const q of coverage.openQuestions.slice(0, 4)) {
    const line = `- UNRESOLVED in [${q.sectionId}]: ${q.text}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Convenience: build + format in one step. */
export function buildConceptCoverageBlock(
  sections: NoteSectionLike[],
  opts?: { relevanceText?: string; maxChars?: number; maxConcepts?: number }
): string {
  return formatConceptCoverage(extractConceptCoverage(sections), opts);
}
