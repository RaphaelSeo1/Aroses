/**
 * Cross-section redundancy control for generated notes.
 *
 * The existing fold helpers keep a single section free of duplicate lines and
 * merge whole sections that share a topic. What they do NOT catch is the most
 * common lecture artefact: section B re-explains a concept that section A
 * already explained, using a different heading. This module finds those
 * repeated explanations across sections, keeps the clearest copy in the
 * earliest (owner) section, folds any unique details from the later copy into
 * the owner, and removes only the redundant portion.
 *
 * Deterministic (no model call), subject-neutral, and conservative:
 *   - lines whose numbers differ are different facts → never merged;
 *   - worked steps ("1. ") only merge on exact normalized equality;
 *   - headings, tables, "> (AI)", **Open question:** and **Why it matters:**
 *     lines are never touched (emphasis and unresolved items survive).
 */

import {
  dedupeSectionLines,
  extractBoldTerms,
  extractNoteHeading,
  lineTokenOverlap,
  normalizeLine,
  placeIncomingNoteLines,
} from "@/lib/live-notes/fold-note-markdown";
import {
  conceptKey,
  extractConceptCoverage,
  isDefinitionLine,
  lineMentionsConcept,
  type ConceptCoverage,
  type NoteSectionLike,
} from "@/lib/notes/concept-coverage";

/** Token-set overlap at/above which two body lines say the same thing. */
export const CROSS_SECTION_DUPLICATE_THRESHOLD = 0.72;
/** Overlap at/above which a second definition of an already-defined concept is redundant. */
export const REPEATED_DEFINITION_THRESHOLD = 0.45;
const MIN_LINE_CHARS = 12;

export type DedupeSection = NoteSectionLike & { studentEdited?: boolean };

function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line.trim());
}

function isTable(line: string): boolean {
  return /^\s*\|/.test(line);
}

function isNumberedStep(line: string): boolean {
  return /^\s*\d+\.\s/.test(line);
}

/** Lines that carry emphasis / provenance / uncertainty — never removed. */
export function isProtectedNoteLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (isHeading(t) || isTable(t)) return true;
  if (/^>\s*/.test(t)) return true;
  if (/\*\*open question:\*\*/i.test(t)) return true;
  if (/\*\*why it matters:\*\*/i.test(t)) return true;
  if (/\*\*remember(?: this)?:\*\*/i.test(t)) return true;
  return false;
}

function numbersOf(norm: string): string {
  return (norm.match(/\d+(?:\.\d+)?/g) ?? []).join(",");
}

function bulletDepth(line: string): number {
  if (/^\s{2,}(?:[-*]|\d+\.)\s/.test(line)) return 1;
  if (/^(?:[-*]|\d+\.)\s/.test(line)) return 0;
  return -1;
}

function lineRichness(line: string): number {
  return normalizeLine(line).length + extractBoldTerms(line).length * 12;
}

/**
 * Is `later` a restatement of `earlier` (same fact, possibly reworded)?
 * Different numbers ⇒ different facts ⇒ false.
 */
export function isRepeatedNoteLine(earlier: string, later: string): boolean {
  if (isProtectedNoteLine(earlier) || isProtectedNoteLine(later)) return false;
  const na = normalizeLine(earlier);
  const nb = normalizeLine(later);
  if (na.length < MIN_LINE_CHARS || nb.length < MIN_LINE_CHARS) return false;
  if (na === nb) return true;
  if (isNumberedStep(earlier) || isNumberedStep(later)) return false;
  if (numbersOf(na) !== numbersOf(nb)) return false;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 24 && longer.includes(shorter)) return true;
  return lineTokenOverlap(na, nb) >= CROSS_SECTION_DUPLICATE_THRESHOLD;
}

/** Bold lead-in label of a bullet, if any. */
function leadInLabel(line: string): string | null {
  const m = line.trim().match(/^(?:[-*]|\d+\.)\s+\*\*([^*]+)\*\*/);
  return m ? m[1]!.trim().replace(/[:：\-–—]+\s*$/, "") : null;
}

/**
 * A later line re-defines a concept that an earlier line already defines.
 * Requires a definition shape on both sides plus moderate content overlap so
 * a genuinely new fact about the same concept is not treated as a repeat.
 */
export function isRepeatedDefinition(earlier: string, later: string): boolean {
  if (isProtectedNoteLine(earlier) || isProtectedNoteLine(later)) return false;
  const label = leadInLabel(later) ?? leadInLabel(earlier);
  if (!label) return false;
  const key = conceptKey(label);
  if (!key || !lineMentionsConcept(earlier, key) || !lineMentionsConcept(later, key)) {
    return false;
  }
  if (!isDefinitionLine(earlier, label) || !isDefinitionLine(later, label)) {
    return false;
  }
  const na = normalizeLine(earlier);
  const nb = normalizeLine(later);
  if (numbersOf(na) !== numbersOf(nb)) return false;
  return lineTokenOverlap(na, nb) >= REPEATED_DEFINITION_THRESHOLD;
}

export type RepeatedExplanation = {
  laterSectionId: string;
  laterLineIndex: number;
  ownerSectionId: string;
  ownerLineIndex: number;
  kind: "duplicate" | "definition";
};

/** Locate every later-section line that repeats an earlier section's line. */
export function findRepeatedExplanations(
  sections: DedupeSection[]
): RepeatedExplanation[] {
  const out: RepeatedExplanation[] = [];
  const split = sections.map((s) => s.markdown.replace(/\r\n/g, "\n").split("\n"));
  for (let j = 1; j < sections.length; j++) {
    const laterLines = split[j]!;
    for (let li = 0; li < laterLines.length; li++) {
      const later = laterLines[li]!;
      if (isProtectedNoteLine(later)) continue;
      if (normalizeLine(later).length < MIN_LINE_CHARS) continue;
      let hit: RepeatedExplanation | null = null;
      for (let i = 0; i < j && !hit; i++) {
        const earlierLines = split[i]!;
        for (let ei = 0; ei < earlierLines.length; ei++) {
          const earlier = earlierLines[ei]!;
          if (isRepeatedNoteLine(earlier, later)) {
            hit = {
              laterSectionId: sections[j]!.sectionId,
              laterLineIndex: li,
              ownerSectionId: sections[i]!.sectionId,
              ownerLineIndex: ei,
              kind: "duplicate",
            };
            break;
          }
          if (isRepeatedDefinition(earlier, later)) {
            hit = {
              laterSectionId: sections[j]!.sectionId,
              laterLineIndex: li,
              ownerSectionId: sections[i]!.sectionId,
              ownerLineIndex: ei,
              kind: "definition",
            };
            break;
          }
        }
      }
      if (hit) out.push(hit);
    }
  }
  return out;
}

export type ConsolidationResult = {
  sections: DedupeSection[];
  /** Later sections that became empty because everything they said was already covered. */
  removeSectionIds: string[];
  /** Human-readable audit of what moved/was dropped (for logs/tests). */
  trimmed: Array<{ sectionId: string; removed: string[]; pointer?: string }>;
  changed: boolean;
};

function bodyLineCount(lines: string[]): number {
  return lines.filter((l) => l.trim() && !isHeading(l)).length;
}

/**
 * Consolidate repeated explanations across sections:
 *   - the richer copy ends up in the owner (earliest) section;
 *   - nested details under a removed later line fold into the owner;
 *   - the later section keeps everything that is new; a one-line pointer
 *     replaces a removed definition when the later section still has content;
 *   - a later section left with nothing new is reported in removeSectionIds.
 * Student-edited sections are never modified (neither trimmed nor upgraded).
 */
export function consolidateRepeatedExplanations(
  input: DedupeSection[]
): ConsolidationResult {
  const sections = input.map((s) => ({ ...s }));
  const lines = sections.map((s) => s.markdown.replace(/\r\n/g, "\n").split("\n"));
  const removeSectionIds: string[] = [];
  const trimmed: ConsolidationResult["trimmed"] = [];
  let changed = false;

  for (let j = 1; j < sections.length; j++) {
    const later = sections[j]!;
    if (later.studentEdited) continue;
    const laterLines = lines[j]!;
    const before = bodyLineCount(laterLines);
    if (before === 0) continue;
    const removed: string[] = [];
    const pointers = new Set<string>();
    let pointerText: string | undefined;
    const keep: string[] = [];

    let li = 0;
    while (li < laterLines.length) {
      const line = laterLines[li]!;
      const depth = bulletDepth(line);
      // Group: a top-level bullet plus its nested children.
      const group: string[] = [line];
      let next = li + 1;
      if (depth === 0) {
        while (next < laterLines.length && bulletDepth(laterLines[next]!) === 1) {
          group.push(laterLines[next]!);
          next += 1;
        }
      }

      let match: { i: number; ei: number; kind: "duplicate" | "definition" } | null =
        null;
      if (!isProtectedNoteLine(line) && normalizeLine(line).length >= MIN_LINE_CHARS) {
        for (let i = 0; i < j && !match; i++) {
          const earlierLines = lines[i]!;
          for (let ei = 0; ei < earlierLines.length; ei++) {
            const earlier = earlierLines[ei]!;
            if (isRepeatedNoteLine(earlier, line)) {
              match = { i, ei, kind: "duplicate" };
              break;
            }
            if (isRepeatedDefinition(earlier, line)) {
              match = { i, ei, kind: "definition" };
              break;
            }
          }
        }
      }

      if (!match) {
        keep.push(...group);
        li = next;
        continue;
      }

      const owner = sections[match.i]!;
      const ownerLines = lines[match.i]!;
      const ownerLine = ownerLines[match.ei]!;
      if (!owner.studentEdited) {
        // Keep the richer wording in the owner, then fold unique children in.
        if (lineRichness(line) > lineRichness(ownerLine) && bulletDepth(line) === bulletDepth(ownerLine)) {
          ownerLines[match.ei] = line;
        }
        const children = group.slice(1);
        if (children.length > 0) {
          const merged = placeIncomingNoteLines(
            ownerLines.join("\n"),
            [ownerLines[match.ei]!, ...children].join("\n")
          );
          lines[match.i] = merged.split("\n");
        }
        sections[match.i] = { ...owner, markdown: lines[match.i]!.join("\n") };
      }

      removed.push(...group);
      changed = true;

      // A removed definition leaves a one-line pointer so the later section
      // still reads coherently (brief reminder, not a second explanation).
      const label = leadInLabel(line);
      if (label && (match.kind === "definition" || isDefinitionLine(line, label))) {
        const ownerHeading = extractNoteHeading(owner.markdown);
        if (ownerHeading && !pointers.has(conceptKey(label))) {
          pointers.add(conceptKey(label));
          pointerText = `- **${label}** — see "${ownerHeading}" above; only new details here.`;
          keep.push(pointerText);
        }
      }
      li = next;
    }

    if (removed.length === 0) continue;

    const remainingBody = keep.filter(
      (l) => l.trim() && !isHeading(l) && l !== pointerText
    );
    if (remainingBody.length === 0) {
      // Everything the later section said was already covered — drop it.
      removeSectionIds.push(later.sectionId);
      trimmed.push({ sectionId: later.sectionId, removed });
      lines[j] = keep;
      sections[j] = { ...later, markdown: "" };
      continue;
    }
    const md = dedupeSectionLines(keep.join("\n"));
    lines[j] = md.split("\n");
    sections[j] = { ...later, markdown: md };
    trimmed.push({ sectionId: later.sectionId, removed, pointer: pointerText });
  }

  // Owners that were upgraded need a final intra-section dedupe.
  const finalSections = sections.map((s) =>
    s.studentEdited || !s.markdown ? s : { ...s, markdown: dedupeSectionLines(s.markdown) }
  );
  const removeSet = new Set(removeSectionIds);
  return {
    sections: finalSections.filter((s) => !removeSet.has(s.sectionId)),
    removeSectionIds,
    trimmed,
    changed,
  };
}

/**
 * Live-time guard: drop incoming body lines that merely restate something
 * that already exists in OTHER sections of the document. Children of a
 * dropped parent are kept (promoted one level) when they carry new content.
 */
export function stripLinesAlreadyCovered(
  incomingMd: string,
  otherSections: NoteSectionLike[]
): string {
  const incoming = incomingMd.replace(/\r\n/g, "\n");
  if (!incoming.trim() || otherSections.length === 0) return incoming.trim();
  const pool: string[] = [];
  for (const s of otherSections) {
    for (const l of s.markdown.split("\n")) {
      if (!isProtectedNoteLine(l) && normalizeLine(l).length >= MIN_LINE_CHARS) {
        pool.push(l);
      }
    }
  }
  if (pool.length === 0) return incoming.trim();

  const out: string[] = [];
  let droppedParent = false;
  for (const line of incoming.split("\n")) {
    const depth = bulletDepth(line);
    if (depth !== 1) droppedParent = false;
    if (isProtectedNoteLine(line) || normalizeLine(line).length < MIN_LINE_CHARS) {
      out.push(line);
      continue;
    }
    const covered = pool.some(
      (p) => isRepeatedNoteLine(p, line) || isRepeatedDefinition(p, line)
    );
    if (covered) {
      if (depth === 0) droppedParent = true;
      continue;
    }
    if (depth === 1 && droppedParent) {
      out.push(line.replace(/^\s+/, ""));
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Bounded semantic pass (model-assisted, wrap-up only) ────────────────────

export type SemanticTrimCandidate = {
  label: string;
  ownerSectionId: string;
  ownerHeading: string;
  ownerLines: string[];
  later: Array<{
    sectionId: string;
    heading: string;
    /** 1-based line numbers within the section markdown + the line text. */
    lines: Array<{ n: number; text: string }>;
  }>;
};

/**
 * Concepts that still look defined/explained in more than one section after
 * the deterministic pass. Only these (compact excerpts, not the whole doc)
 * go to the model for a meaning-level check.
 */
export function findSemanticTrimCandidates(
  sections: DedupeSection[],
  coverage: ConceptCoverage = extractConceptCoverage(sections),
  opts?: { maxCandidates?: number; maxLinesPerSection?: number }
): SemanticTrimCandidate[] {
  const maxCandidates = opts?.maxCandidates ?? 12;
  const maxLines = opts?.maxLinesPerSection ?? 6;
  const byId = new Map(sections.map((s) => [s.sectionId, s] as const));
  const out: SemanticTrimCandidate[] = [];

  for (const c of coverage.concepts) {
    if (c.state === "mentioned") continue;
    const owner = byId.get(c.ownerSectionId);
    if (!owner) continue;
    const ownerLines = owner.markdown
      .split("\n")
      .filter((l) => !isProtectedNoteLine(l) && lineMentionsConcept(l, c.key))
      .slice(0, maxLines)
      .map((l) => l.trim());
    if (ownerLines.length === 0) continue;

    const later: SemanticTrimCandidate["later"] = [];
    for (const sid of c.mentionedIn) {
      if (sid === c.ownerSectionId) continue;
      const s = byId.get(sid);
      if (!s || s.studentEdited) continue;
      const lines = s.markdown.split("\n");
      const hits: Array<{ n: number; text: string }> = [];
      let explanatory = false;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!;
        if (isProtectedNoteLine(l) || !lineMentionsConcept(l, c.key)) continue;
        if (isDefinitionLine(l, c.label) || normalizeLine(l).length >= 60) {
          explanatory = true;
        }
        hits.push({ n: i + 1, text: l.trim() });
        if (hits.length >= maxLines) break;
      }
      // A bare mention is fine; only later *explanations* are candidates.
      if (hits.length > 0 && explanatory) {
        later.push({
          sectionId: sid,
          heading: extractNoteHeading(s.markdown) ?? "(untitled)",
          lines: hits,
        });
      }
    }
    if (later.length === 0) continue;
    out.push({
      label: c.label,
      ownerSectionId: c.ownerSectionId,
      ownerHeading: c.ownerHeading,
      ownerLines,
      later,
    });
    if (out.length >= maxCandidates) break;
  }
  return out;
}

export function formatSemanticTrimCandidates(
  candidates: SemanticTrimCandidate[]
): string {
  return candidates
    .map((c, idx) => {
      const laterBlocks = c.later
        .map(
          (l) =>
            `  LATER [${l.sectionId}] ${l.heading}\n${l.lines
              .map((x) => `    (${x.n}) ${x.text}`)
              .join("\n")}`
        )
        .join("\n");
      return `CANDIDATE ${idx + 1}: **${c.label}**\n  OWNER [${c.ownerSectionId}] ${c.ownerHeading}\n${c.ownerLines
        .map((x) => `    ${x}`)
        .join("\n")}\n${laterBlocks}`;
    })
    .join("\n\n");
}

export type SemanticTrim = { sectionId: string; dropLineNumbers: number[] };

/**
 * Parse `{ "trims": [{ "sectionId", "dropLineNumbers": [n, …] }] }`.
 * Only section ids and line numbers that were actually offered are accepted —
 * the model cannot delete anything it was not shown.
 */
export function parseSemanticTrimJson(
  raw: string,
  candidates: SemanticTrimCandidate[]
): SemanticTrim[] {
  const text = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: { trims?: unknown };
  try {
    parsed = JSON.parse(text) as { trims?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.trims)) return [];
  const offered = new Map<string, Set<number>>();
  for (const c of candidates) {
    for (const l of c.later) {
      const set = offered.get(l.sectionId) ?? new Set<number>();
      for (const x of l.lines) set.add(x.n);
      offered.set(l.sectionId, set);
    }
  }
  const out = new Map<string, Set<number>>();
  for (const t of parsed.trims) {
    if (!t || typeof t !== "object") continue;
    const sid = (t as { sectionId?: unknown }).sectionId;
    const nums = (t as { dropLineNumbers?: unknown }).dropLineNumbers;
    if (typeof sid !== "string" || !Array.isArray(nums)) continue;
    const allowed = offered.get(sid);
    if (!allowed) continue;
    const set = out.get(sid) ?? new Set<number>();
    for (const n of nums) {
      if (typeof n === "number" && Number.isInteger(n) && allowed.has(n)) set.add(n);
    }
    if (set.size > 0) out.set(sid, set);
  }
  return [...out.entries()].map(([sectionId, set]) => ({
    sectionId,
    dropLineNumbers: [...set].sort((a, b) => a - b),
  }));
}

/**
 * Apply accepted trims. A trim that would leave a section with no body is
 * skipped (pure duplicates are the deterministic pass's job, not the model's).
 */
export function applySemanticTrims(
  sections: DedupeSection[],
  trims: SemanticTrim[]
): { sections: DedupeSection[]; changed: boolean } {
  if (trims.length === 0) return { sections, changed: false };
  const byId = new Map(trims.map((t) => [t.sectionId, new Set(t.dropLineNumbers)]));
  let changed = false;
  const next = sections.map((s) => {
    const drop = byId.get(s.sectionId);
    if (!drop || s.studentEdited) return s;
    const lines = s.markdown.split("\n");
    const kept = lines.filter((l, i) => {
      if (!drop.has(i + 1)) return true;
      return isProtectedNoteLine(l);
    });
    if (bodyLineCount(kept) === 0) return s;
    if (kept.length === lines.length) return s;
    changed = true;
    return { ...s, markdown: dedupeSectionLines(kept.join("\n")) };
  });
  return { sections: next, changed };
}
