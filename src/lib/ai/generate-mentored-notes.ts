/**
 * Streams free-form study notes for a mentored lesson chunk.
 * Unlike the old client-side template builder, this writes organic,
 * in-depth notes as if the student asked an AI tutor for help.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { KeyTerm } from "@/types/course";
import type { MentoredLessonChunk } from "@/types/mentored";

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
};

const SYSTEM = `You write excellent study notes for a student learning from a live tutoring session.

Your job: produce specific, in-depth notes about what is being taught — the kind a thoughtful student would want before an exam.

Guidelines:
- Write from the student's perspective. Be concrete: explain what things are, how they work, why they matter, and how ideas connect.
- Use markdown naturally (headings, bullets, bold) only when it helps clarity. Let structure emerge organically — do NOT force rigid sections like "Key Terms:" or "Summary:" unless that genuinely fits the material.
- Include examples, formulas, or worked steps when the source material includes them.
- Be substantive and specific to THIS topic — no generic study-skills fluff.
- Do NOT mention Rose, the session, note-taking, or that you are an AI. Only domain content.
- Do NOT wrap output in code fences. Return notes only.`;

function buildUserPrompt(input: MentoredNotesInput): string {
  const {
    chunk,
    courseTitle,
    moduleTitle,
    lessonTitle,
    lessonExcerpt,
    courseKeyTerms = [],
    roseSpoken,
  } = input;

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
    max_tokens: 1200,
    temperature: 0.4,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
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
