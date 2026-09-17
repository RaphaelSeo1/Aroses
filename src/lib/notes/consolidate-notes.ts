/**
 * Shared, deterministic document consolidation for EVERY note generator
 * (live lecture notes, mentored lesson notes, tutor-session notes).
 *
 * One pipeline, no model calls:
 *   1. sanitize + intra-section line dedupe (AI-owned sections only);
 *   2. remove repeated explanations across sections, keeping the owner's
 *      copy and folding unique details into it;
 *   3. merge whole sections that are still the same topic (earliest kept);
 *   4. strip editor-like navigation language.
 *
 * Preserves: unique facts, numbers, tables, worked steps, emphasis lines,
 * open questions, and every student-edited section (never touched, never
 * used as a merge target).
 */

import {
  dedupeSectionLines,
  extractNoteHeading,
  headingsReferToSameTopic,
  mergeDuplicateGroup,
  sectionBodySimilarity,
  type NoteSectionRef,
} from "@/lib/live-notes/fold-note-markdown";
import { sanitizeNoteOutput } from "@/lib/live-notes/sanitize-note-output";
import {
  consolidateRepeatedExplanations,
  stripEditorialNavigationLines,
  type DedupeSection,
} from "@/lib/notes/cross-section-dedupe";

export type ConsolidateNoteDocumentResult = {
  /** Surviving sections in document order (student sections unchanged). */
  sections: DedupeSection[];
  /** Sections whose markdown differs from the input (apply as replacements). */
  revisions: Array<{ sectionId: string; markdown: string }>;
  /** Sections absorbed elsewhere or left with nothing new (apply as deletes). */
  removeSectionIds: string[];
  changed: boolean;
};

/** Body similarity at/above which two differently-headed sections are one topic. */
const SAME_TOPIC_BODY_THRESHOLD = 0.6;
/** A section needs this many body bullets before body similarity alone can absorb it. */
const MIN_BULLETS_FOR_BODY_MERGE = 3;

function bulletCount(markdown: string): number {
  return markdown
    .split("\n")
    .filter((l) => /^\s*(?:[-*]|\d+\.)\s/.test(l)).length;
}

/**
 * Same-topic groups (earliest kept). Runs AFTER repeated lines were removed,
 * so similarity reflects what each section still says on its own. Heading
 * sameness is decisive; body similarity alone must be strong and backed by
 * enough bullets — a small section with one overlapping bullet is not merged.
 */
function findSameTopicGroups(
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
      const sameHeading = headingsReferToSameTopic(ha, hb);
      const sameBody =
        bulletCount(b.markdown) >= MIN_BULLETS_FOR_BODY_MERGE &&
        sectionBodySimilarity(a.markdown, b.markdown) >= SAME_TOPIC_BODY_THRESHOLD;
      if (sameHeading || sameBody) {
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

export function consolidateNoteDocument(
  input: DedupeSection[]
): ConsolidateNoteDocumentResult {
  const original = new Map(input.map((s) => [s.sectionId, s.markdown]));
  const removeSet = new Set<string>();

  // 1) Per-section polish (AI-owned only).
  let working: DedupeSection[] = input.map((s) => {
    if (s.studentEdited) return { ...s };
    const md = dedupeSectionLines(sanitizeNoteOutput(s.markdown));
    return { ...s, markdown: md };
  });

  // 2) Repeated explanations across sections (owner keeps the explanation,
  //    unique details fold into it, later sections keep only what is new).
  const consolidated = consolidateRepeatedExplanations(working);
  for (const id of consolidated.removeSectionIds) removeSet.add(id);
  working = consolidated.sections;

  // 3) Same-topic sections → one section. Only AI-owned sections may be
  //    merged or absorbed; student sections are invisible to this step.
  const mergeable = working.filter((s) => !s.studentEdited && s.markdown.trim());
  for (const group of findSameTopicGroups(mergeable)) {
    const merged = mergeDuplicateGroup(group);
    working = working.map((s) =>
      s.sectionId === merged.sectionId ? { ...s, markdown: merged.markdown } : s
    );
    for (const id of merged.removeSectionIds) removeSet.add(id);
  }
  working = working.filter((s) => !removeSet.has(s.sectionId));

  // 4) No editor-like navigation language in student-facing notes.
  working = working.map((s) =>
    s.studentEdited
      ? s
      : { ...s, markdown: stripEditorialNavigationLines(s.markdown) }
  );

  // Sections emptied by polishing are removed rather than left heading-only.
  working = working.filter((s) => {
    if (s.studentEdited) return true;
    if (s.markdown.trim()) return true;
    if (original.has(s.sectionId)) removeSet.add(s.sectionId);
    return false;
  });

  const revisions = working
    .filter((s) => !s.studentEdited && original.get(s.sectionId) !== s.markdown)
    .map((s) => ({ sectionId: s.sectionId, markdown: s.markdown }));
  const removeSectionIds = [...removeSet];
  return {
    sections: working,
    revisions,
    removeSectionIds,
    changed: revisions.length > 0 || removeSectionIds.length > 0,
  };
}
