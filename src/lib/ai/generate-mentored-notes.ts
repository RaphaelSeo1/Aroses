/**
 * Streams free-form study notes for a mentored lesson chunk.
 * Unlike the old client-side template builder, this writes organic,
 * in-depth notes as if the student asked an AI tutor for help.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { KeyTerm } from "@/types/course";
import type { MentoredLessonChunk } from "@/types/mentored";
import { buildNoteInstructionModifier } from "@/lib/ai/note-instruction";
import {
  DEFAULT_NOTES_OUTLINE_RULES,
  UNIFIED_NOTES_RULES,
} from "@/lib/ai/tutor-notes-quality";

/** Cap for the caller-supplied "already in the notes" coverage block. */
export const MAX_PRIOR_NOTES_COVERAGE_CHARS = 3_000;

const MODEL =
  process.env.ANTHROPIC_TUTOR_MODEL?.trim() || "claude-sonnet-4-6";

export type MentoredNotesInput = {
  chunk: MentoredLessonChunk;
  courseTitle: string;
  moduleTitle: string;
  lessonTitle?: string;
  /** Truncated source lesson markdown the chunk maps to. */
  lessonExcerpt?: string;
  courseKeyTerms?: KeyTerm[];
  /** Optional transcript of what Rose has already said for this chunk. */
  roseSpoken?: string;
  /** Per-session free-text style request. Empty/missing ⇒ base SYSTEM unchanged. */
  noteInstruction?: string;
  /**
   * Compact concept-coverage block describing what earlier chunks already put
   * in the student's notebook (see `buildConceptCoverageBlock`). Lets this
   * chunk add only new information instead of re-explaining.
   */
  priorNotesCoverage?: string;
};

const SYSTEM = `You write excellent study notes for a student learning from a live tutoring session.

Your job: produce specific, in-depth notes about what is being taught — the kind a thoughtful student would want before an exam. These notes are ONE section of a notebook that already contains the earlier chunks of this lesson.

${DEFAULT_NOTES_OUTLINE_RULES}

${UNIFIED_NOTES_RULES}

Guidelines:
- Write from the student's perspective. Be concrete: explain what things are, how they work, why they matter, and how ideas connect.
- Use this markdown subset only: "## " / "### " headings, "- " bullets ("  - " nested), "1. " numbered steps, "**bold**" for key terms, and GFM pipe tables when comparing options/criteria (header row, a "| --- | --- |" separator, then data rows). Do NOT use single-asterisk *italic* or other markup — unclosed markers show up as raw asterisks.
- Let structure emerge organically — do NOT force rigid sections like "Key Terms:" or "Summary:" unless that genuinely fits the material.
- Include examples, formulas, or worked steps when the source material includes them.
- Be substantive and specific to THIS topic — no generic study-skills fluff. Finish every list and explanation you start; do not leave stub lines.
- Do NOT mention Rose, the session, note-taking, or that you are an AI. Only domain content.
- Do NOT wrap output in code fences. Return notes only.`;

/**
 * Layer the student's per-session note request under the base guidelines
 * (structure still emerges organically; grounding and no-code-fences rules
 * above always win). Empty instruction ⇒ base SYSTEM, byte-for-byte.
 */
function mentoredSystem(noteInstruction: string | undefined): string {
  const modifier = buildNoteInstructionModifier(noteInstruction);
  if (!modifier) return SYSTEM;
  return `${SYSTEM}\n${modifier}`;
}

export function buildMentoredNotesPrompt(input: MentoredNotesInput): string {
  const {
    chunk,
    courseTitle,
    moduleTitle,
    lessonTitle,
    lessonExcerpt,
    courseKeyTerms = [],
    roseSpoken,
  } = input;
  const priorCoverage = (input.priorNotesCoverage ?? "")
    .trim()
    .slice(0, MAX_PRIOR_NOTES_COVERAGE_CHARS);

  const termLines = courseKeyTerms
    .slice(0, 12)
    .map((t) => `- ${t.term}: ${t.definition}`)
    .join("\n");

  const parts = [
    `Course: ${courseTitle}`,
    `Module: ${moduleTitle}`,
    lessonTitle ? `Lesson: ${lessonTitle}` : null,
    "",
    `Concept being taught: ${chunk.concept}`,
    "",
    "Rose's planned explanation:",
    chunk.explanation.trim(),
    "",
    chunk.keyPoints.length > 0
      ? `Key points to cover:\n${chunk.keyPoints.map((p) => `- ${p}`).join("\n")}`
      : null,
    chunk.referenceAnswer.trim()
      ? `Reference answer (for depth, not to copy verbatim):\n${chunk.referenceAnswer.trim()}`
      : null,
    chunk.analogy?.trim() ? `Analogy Rose may use: ${chunk.analogy.trim()}` : null,
    chunk.keyTerms?.length
      ? `Terms in this chunk: ${chunk.keyTerms.join(", ")}`
      : null,
    termLines ? `Course vocabulary (use only when relevant):\n${termLines}` : null,
    priorCoverage
      ? `ALREADY IN THE STUDENT'S NOTES (from earlier chunks — do not re-define or re-explain these; write only what this chunk adds, with at most a one-clause reminder where needed):\n${priorCoverage}`
      : null,
    lessonExcerpt?.trim()
      ? `Source lesson excerpt:\n---\n${lessonExcerpt.trim()}\n---`
      : null,
    roseSpoken?.trim()
      ? `What Rose has already said in this segment:\n${roseSpoken.trim()}`
      : null,
    "",
    "Write thorough study notes for this concept now.",
  ];

  return parts.filter((p) => p != null).join("\n");
}

export async function* streamMentoredNotes(
  input: MentoredNotesInput
): AsyncGenerator<{ type: "text"; delta: string }, void, void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 3_000,
    temperature: 0.4,
    system: mentoredSystem(input.noteInstruction),
    messages: [{ role: "user", content: buildMentoredNotesPrompt(input) }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta" &&
      event.delta.text
    ) {
      yield { type: "text", delta: event.delta.text };
    }
  }
}
