export type CanonicalNoteSourceBundle = {
  transcript?: string;
  deck?: string;
  screen?: string;
  materials?: Array<{ name: string; text: string }>;
  /** False means at least one expected source failed to load or was truncated. */
  complete?: boolean;
  incompleteReasons?: string[];
};

export type CanonicalDraftSection = {
  sectionId: string;
  markdown: string;
  studentEdited?: boolean;
};

const MAX_TRANSCRIPT_CHARS = 250_000;
const MAX_DECK_CHARS = 400_000;
const MAX_SCREEN_CHARS = 80_000;
const MAX_MATERIAL_CHARS = 80_000;
const MAX_DRAFT_CHARS = 100_000;

export const CANONICAL_NOTES_SYSTEM = `You are the final editor of source-grounded study notes.

Your task is not to append to the current notes. Reconstruct the best complete version of the notes from all AUTHORITATIVE SOURCES currently supplied.

EVIDENCE:
- The authoritative evidence is the supplied transcript/audio text, slides/deck, on-screen extracts, and uploaded course materials.
- EXISTING AI DRAFT sections are editable drafts, not evidence. A statement appearing there does not justify keeping it.
- STUDENT-EDITED sections are protected context. Do not reproduce them in your AI draft unless a short cross-reference is essential.
- Never add outside subject knowledge, invented examples, inferred numbers, or facts that occur only in the existing draft.

SOURCE-AWARE SYNTHESIS:
- Files/slides only: produce comprehensive notes from their instructional content. Keep detailed definitions, mechanisms, examples, lists, labels, tables, and formulas when supported. Exclude obvious noise such as publication metadata, copyright lines, raw reference lists, citation numbers, irrelevant URLs, repeated OCR, formatting artifacts, and machine identifiers.
- Transcript only: preserve what the lecturer teaches, including explanations, mechanisms, analogies, examples, clarifications, questions and answers, distinctions, instructional reasoning, repeated emphasis, and explicit exam comments. Remove speech filler and logistics, not teaching.
- Multiple source types: integrate them concept-by-concept. Transcript may establish explanation, emphasis, and intended depth. Slides/files may establish structure, terminology, diagrams, labels, formulas, tables, and instructional points that were not spoken word-for-word. A supported point does not need to appear in every source.
- Treat extracted table cells, figure/diagram descriptions, labels, legends, and relationships as instructional source content when supplied. Reconstruct tables where useful; explain diagram relationships without pretending you saw visual details that were not extracted.
- Never guess what will be tested and never remove a supported detail merely because it looks advanced. Match the level of detail actually supported by the sources.
- When uncertain whether supported content is incidental, preserve it concisely rather than deleting it aggressively.

GLOBAL EDITING:
- Give each major concept one canonical location.
- Merge overlapping headings and explanations. Integrate later explanations into the relevant concept instead of creating another summary of it.
- Rewrite, reorder, expand, condense, or remove AI-draft material whenever the supplied sources support doing so.
- Preserve causal reasoning, step-by-step mechanisms, useful analogies, instructor clarifications, distinctions, and answers to confusion.
- Repetition is allowed only for a brief useful cross-reference or where a fact is needed inside a separate worked example/application.
- Before answering, silently check the whole document for source coverage, unsupported claims, and redundancy.

OUTPUT:
- Output only the final AI-authored study notes in Markdown. No preface, commentary, protocol markers, citations to this prompt, or code fence.
- Start every major topic with a specific "## " heading.
- Use short explanatory prose, **bold lead-ins**, nested bullets, numbered steps, and GFM tables where they improve understanding.
- Do not force a fixed number of bullets. Dense source material should remain appropriately detailed; sparse source material should remain short.
- Do not include a generic self-check, study plan, or "what to study next" section unless the sources themselves teach it.`;

function clipped(raw: string | undefined, max: number): string {
  return (raw ?? "").trim().slice(0, max);
}

function sourceBlocks(sources: CanonicalNoteSourceBundle): string[] {
  const blocks: string[] = [];
  const transcript = clipped(sources.transcript, MAX_TRANSCRIPT_CHARS);
  const deck = clipped(sources.deck, MAX_DECK_CHARS);
  const screen = clipped(sources.screen, MAX_SCREEN_CHARS);
  if (transcript) {
    blocks.push(`AUTHORITATIVE SOURCE — LECTURE TRANSCRIPT:\n${transcript}`);
  }
  if (deck) {
    blocks.push(`AUTHORITATIVE SOURCE — SLIDES / DECK:\n${deck}`);
  }
  if (screen) {
    blocks.push(`AUTHORITATIVE SOURCE — ON-SCREEN EXTRACTS:\n${screen}`);
  }
  let materialChars = 0;
  for (const material of sources.materials ?? []) {
    const remaining = MAX_MATERIAL_CHARS - materialChars;
    if (remaining <= 0) break;
    const text = material.text.trim().slice(0, remaining);
    if (!text) continue;
    materialChars += text.length;
    const name = material.name.trim().slice(0, 200) || "Uploaded material";
    blocks.push(`AUTHORITATIVE SOURCE — UPLOADED MATERIAL (${name}):\n${text}`);
  }
  return blocks;
}

export function hasCanonicalNoteSources(
  sources: CanonicalNoteSourceBundle
): boolean {
  return sourceBlocks(sources).length > 0;
}

export function buildCanonicalNotesUserPrompt(input: {
  title?: string;
  sources: CanonicalNoteSourceBundle;
  existingSections?: CanonicalDraftSection[];
  noteInstruction?: string;
}): string {
  const blocks: string[] = [];
  if (input.title?.trim()) {
    blocks.push(`LECTURE / NOTE TITLE: ${input.title.trim().slice(0, 200)}`);
  }
  blocks.push(...sourceBlocks(input.sources));

  let draftChars = 0;
  const aiDraft: string[] = [];
  const protectedDraft: string[] = [];
  for (const section of input.existingSections ?? []) {
    const remaining = MAX_DRAFT_CHARS - draftChars;
    if (remaining <= 0) break;
    const markdown = section.markdown.trim().slice(0, remaining);
    if (!markdown) continue;
    draftChars += markdown.length;
    const entry = `[SECTION ${section.sectionId}]\n${markdown}`;
    if (section.studentEdited) protectedDraft.push(entry);
    else aiDraft.push(entry);
  }
  if (aiDraft.length > 0) {
    blocks.push(
      `EXISTING AI DRAFT — EDITABLE MAP ONLY, NOT EVIDENCE:\n${aiDraft.join("\n\n")}`
    );
  }
  if (protectedDraft.length > 0) {
    blocks.push(
      `STUDENT-EDITED SECTIONS — PRESERVE OUTSIDE YOUR OUTPUT; AVOID DUPLICATING THEM:\n${protectedDraft.join("\n\n")}`
    );
  }
  if (input.noteInstruction?.trim()) {
    blocks.push(
      `STUDENT NOTE STYLE — controls presentation, never source coverage or factual evidence:\n${input.noteInstruction.trim().slice(0, 800)}`
    );
  }
  blocks.push(
    "Produce the best complete AI-authored notes from the authoritative sources now. The order in which the sources arrived is irrelevant."
  );
  return blocks.join("\n\n");
}

/** Split canonical markdown into one addressable H2 topic per section. */
export function splitCanonicalMarkdown(markdown: string): string[] {
  const normalized = markdown
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!normalized) return [];
  const starts: number[] = [];
  const re = /^##\s+\S.*$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized))) starts.push(match.index);
  if (starts.length === 0) return [normalized];

  const sections: string[] = [];
  const preface = normalized.slice(0, starts[0]).trim();
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!;
    const to = starts[i + 1] ?? normalized.length;
    let section = normalized.slice(from, to).trim();
    if (i === 0 && preface) section = `${section}\n\n${preface}`;
    if (section) sections.push(section);
  }
  return sections;
}
