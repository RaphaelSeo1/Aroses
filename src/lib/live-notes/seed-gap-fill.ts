import "server-only";
import {
  MAX_REVISABLE_SECTIONS,
  streamLiveLectureNotes,
} from "@/lib/ai/live-lecture-notes";
import { classifyAppendChunks } from "@/lib/live-notes/fold-note-markdown";
import { pickRevisableByTranscript } from "@/lib/live-notes/pick-relevant-slide-pages";
import { sanitizeNoteOutput } from "@/lib/live-notes/sanitize-note-output";
import {
  formatDeckPages,
  MAX_DECK_SEED_CHARS,
  type DeckPage,
} from "@/lib/live-notes/slide-pages";
import type {
  CoverageNoteSection,
  CoverageRepair,
  SourceCoverageAudit,
} from "@/lib/notes/source-coverage-ledger";

const MAX_SECTION_CHARS = 8_000;

/**
 * Pages the audit found MISSING, in deck order, trimmed to what one seed call
 * can read. Anything past the cap is left to the deterministic safety net.
 */
export function pickGapPages(deckPages: DeckPage[], audit: SourceCoverageAudit): DeckPage[] {
  const missing = new Set(
    audit.units.filter((u) => u.status === "missing").map((u) => u.unitId)
  );
  const chosen: DeckPage[] = [];
  let used = 0;
  for (const p of deckPages) {
    if (!missing.has(String(p.pageNum))) continue;
    const blockLen = p.title.length + p.extractedText.length + 24;
    if (chosen.length > 0 && used + blockLen > MAX_DECK_SEED_CHARS) break;
    chosen.push(p);
    used += blockLen;
  }
  return chosen;
}

/**
 * Turn one seed-mode model response (ops + text) into coverage repairs the
 * client already knows how to apply: `@@revise` → extend that section,
 * `@@append` → new sections per `## ` chunk (folded into an existing section
 * when the heading matches). Delete ops are ignored — this pass only adds.
 */
export function collectGapFillRepairs(
  ops: Array<{ op: "append" | "revise" | "delete"; sectionId: string; body: string }>,
  sections: CoverageNoteSection[],
  unitIds: string[],
  mintId: () => string
): CoverageRepair[] {
  const repairs: CoverageRepair[] = [];
  const known = new Set(sections.map((s) => s.sectionId));
  for (const o of ops) {
    const body = sanitizeNoteOutput(o.body).trim();
    if (!body) continue;
    if (o.op === "revise") {
      if (!known.has(o.sectionId)) {
        repairs.push({ kind: "new", sectionId: mintId(), markdown: body, unitIds });
        continue;
      }
      // A fragment must not carry its own H2 — the client appends it to the section.
      const fragment = body
        .split("\n")
        .filter((l) => !/^##\s+/.test(l))
        .join("\n")
        .trim();
      if (fragment) repairs.push({ kind: "extend", sectionId: o.sectionId, markdown: fragment, unitIds });
    } else if (o.op === "append") {
      for (const action of classifyAppendChunks(body, sections)) {
        if (action.kind === "fold") {
          const fragment = action.markdown
            .split("\n")
            .filter((l) => !/^##\s+/.test(l))
            .join("\n")
            .trim();
          if (fragment) repairs.push({ kind: "extend", sectionId: action.sectionId, markdown: fragment, unitIds });
        } else {
          repairs.push({ kind: "new", sectionId: mintId(), markdown: action.markdown, unitIds });
        }
      }
    }
  }
  return repairs;
}

/**
 * One seed-mode model call over the slides the coverage audit found missing,
 * written in the same style as the rest of the draft (not slide text pasted
 * back in). Returns [] when there is nothing to send or the model wrote
 * nothing; the caller falls back to the deterministic verbatim restore.
 */
export async function fillSeedCoverageGaps(input: {
  deckPages: DeckPage[];
  audit: SourceCoverageAudit;
  sections: CoverageNoteSection[];
  rollingSummary: string;
  lectureTitle?: string;
  noteInstruction?: string;
  userId?: string;
}): Promise<{ repairs: CoverageRepair[]; pageNums: number[] }> {
  const pages = pickGapPages(input.deckPages, input.audit);
  if (pages.length === 0) return { repairs: [], pageNums: [] };
  const deckContext = formatDeckPages(pages, MAX_DECK_SEED_CHARS);
  const unitIds = pages.map((p) => String(p.pageNum));

  const existingSections = input.sections.map((s) => ({
    sectionId: s.sectionId,
    markdown: s.markdown.slice(0, MAX_SECTION_CHARS),
    studentEdited: s.studentEdited === true,
  }));
  const revisable = pickRevisableByTranscript(
    existingSections,
    deckContext,
    MAX_REVISABLE_SECTIONS
  );

  const ops: Array<{ op: "append" | "revise" | "delete"; sectionId: string; body: string }> = [];
  let current: { op: "append" | "revise" | "delete"; sectionId: string; body: string } | null = null;
  for await (const ev of streamLiveLectureNotes({
    mode: "seed",
    seedGapFill: true,
    newSegmentText: "",
    rollingSummary: input.rollingSummary,
    recentHeadings: [],
    existingSections,
    revisable,
    appendSectionId: `s-${crypto.randomUUID().slice(0, 8)}`,
    deckContext,
    lectureTitle: input.lectureTitle,
    noteInstruction: input.noteInstruction,
    userId: input.userId,
  })) {
    if (ev.type === "op") {
      current = { op: ev.op, sectionId: ev.sectionId, body: "" };
      ops.push(current);
    } else if (ev.type === "text" && current) {
      current.body += ev.delta;
    }
  }

  const repairs = collectGapFillRepairs(
    ops,
    input.sections,
    unitIds,
    () => `s-${crypto.randomUUID().slice(0, 8)}`
  );
  return { repairs, pageNums: pages.map((p) => p.pageNum) };
}
