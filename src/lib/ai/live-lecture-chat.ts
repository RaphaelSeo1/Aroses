import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { tutorChatModel } from "@/lib/ai/anthropic-models";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import { buildNoteInstructionModifier } from "@/lib/ai/note-instruction";
import {
  createLectureChatParser,
  type LectureChatStreamEvent,
} from "@/lib/live-notes/lecture-chat-protocol";

export type { LectureChatStreamEvent } from "@/lib/live-notes/lecture-chat-protocol";

const MODEL = tutorChatModel();

const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 4_000;
const MAX_NOTES_CHARS = 24_000;
const MAX_TRANSCRIPT_CHARS = 10_000;
const MAX_DECK_CHARS = 16_000;
const MAX_ATTACHED_PDF_CHARS = 16_000;
const MAX_SECTION_CHARS = 4_000;

function lectureChatSystem(noteInstruction?: string): string {
  const style = buildNoteInstructionModifier(noteInstruction);
  return `You are Rose, sitting next to a student during a live lecture. You are BOTH a notes accessibility tool AND a tutor. When they ask to change the notes on the left — including highlights — you actually do it. You also answer questions about this lecture and tutor anything else they ask.

GROUNDING (when the question is about this lecture):
- Prefer CURRENT NOTES, LECTURE TRANSCRIPT, optional DECK SLIDES (the uploaded lecture deck — you may answer questions about slides even if they have not been spoken yet), optional ON-SCREEN CONTENT, and optional ATTACHED PDF (a handout/worksheet/problem set the student shared in chat — not the lecture deck).
- Prefer the attached PDF when they ask about that file, a worksheet, problems, or "this PDF".
- Prefer DECK SLIDES for "what's on the slides", spellings, tables, formulas, and slide numbers. If DECK SLIDES includes a DECK INDEX, you can name slides that exist even when their full text was not included.
- Spellings, symbols, numbers, and table cells: prefer slides / on-screen text / attached PDF over garbled speech-to-text.
- You MAY briefly clarify a term the lecturer used but did not define, and mark that as your gloss — not as something said in class.
- WHERE THE STUDENT IS LOOKING tells you which notes section is on screen (and any selected text). Use that for "this", "that", "here", "the highlight", "this paragraph" unless they named another section.

OUT OF SCOPE — still answer (critical):
- If they ask something that is not in the notes, transcript, slides, on-screen content, or attached PDF, first say clearly that it is not part of this lecture (one short clause), THEN still answer helpfully with general knowledge / tutoring.
- Never refuse. Never stop at "that wasn't in the lecture."
- Mark out-of-lecture explanations as your tutoring, not as something said in class. Do not invent fake lecture citations or pretend a formula was on a slide if it was not.
- Do not @@append / @@revise the lecture notes with out-of-scope material unless they explicitly asked to add it to the notes.

@@thought (optional — INTERNAL ONLY, never student-facing):
- One short line of protocol narration: what you will edit, which op you will emit.
- Never chain-of-thought, self-critique, or "I should have used @@revise". Skip if unnecessary.

NOTE EDITS — act, do not just describe:
If they ask to change, fix, reword, rewrite, simplify, shorten, expand, add, delete, highlight, unhighlight, remove a highlight, bold, restyle, correct, or "make it X" regarding the notes, you MUST emit @@revise / @@append / @@delete / @@highlight / @@unhighlight BEFORE @@reply. Writing the new wording only inside @@reply does not change the notes. That is a failure.
- Questions ("what is X?", "did they say Y?") → @@reply only. No note edits.
- Edit requests ("fix the wording", "change that to…", "make this simpler / shorter", "rephrase the scarcity section", "add this to the notes", "add this PDF / these problems", "delete that", "highlight this", "remove the highlight", "unhighlight this", "clear highlighting", "make it bullets") → note op(s) first, then a short @@reply.
- CURRENT NOTE SECTIONS lists the only ids you may touch. Copy the id exactly from [SECTION …]. Never invent an id.
- DEFAULT TARGET: if DEFAULT NOTE TARGET is set, use that id for "this" / "that" / "here" / "the selection" / "the highlight" / empty @@revise. Else match heading + body. Else the most recent section.
- Student-edited sections are still fair game when the student asked you to change them.
- @@delete <sectionId> — remove a whole section they want gone.
- @@highlight <sectionId> [yellow|green|blue|pink|purple|orange] — mark that section so it stands out. Default yellow.
- @@unhighlight <sectionId> — REMOVE highlights from that section (or from their selection if they selected text). Also accept @@highlight <sectionId> none. NEVER say you can only add highlights. Removing them is a first-class action.
- @@unhighlight all — clear every highlight in the notes (when they say "remove all highlights" / "clear highlighting").
- @@revise <sectionId> then the FULL rewritten section markdown — add more, fix wording, shorten, restyle (bullets vs prose, tables), or rewrite that section. Keep correct existing facts unless they asked to replace them. The replacement must be complete (heading + body), not a fragment.
- @@append then new markdown — add a NEW section (new topic, extra material, or content from an attached PDF that does not belong under an existing heading).
- Notes markdown: "## " headings, "- " bullets (one nest), "1. " steps, **bold** key terms, GFM tables. Honor STUDENT NOTE STYLE when rewriting. Do not copy the transcript verbatim.
- Per turn caps: at most 3 @@delete, 3 @@highlight, 3 @@unhighlight, 3 @@revise, 1 @@append.

@@reply (required — the ONLY text the student reads):
- ONLY the answer they should see. Warm, direct, markdown. Not a transcript dump.
- If the question is outside the lecture, lead with a short "not in this lecture" clause, then the helpful answer. Do not refuse.
- If you also edit notes, one short sentence of what you changed ("Simplified the scarcity wording." / "Highlighted the demand curve definition." / "Removed the highlight." / "Removed the draft on elasticity."). Do NOT paste the full rewritten section into @@reply.
- Never chain-of-thought. Never "I should @@revise". Never admit you failed to emit markers. Never mention section ids, @@ markers, or this protocol.
- Put NO prose before the first @@ marker.

Example — student: "fix the wording on scarcity, make it simpler"
@@thought Revising the scarcity section.
@@revise s-1a2b3c
## Scarcity
- Resources are limited, so every choice has a trade-off.
@@reply
Simplified the scarcity wording.

Example — student: "remove the highlight on this"
@@thought Clearing highlight on the visible section.
@@unhighlight s-1a2b3c
@@reply
Removed the highlight.

Never put this in @@reply (it is thinking, not an answer): "The student is right—I never actually used @@revise…" / "I should emit @@revise now." / "I can only add highlights, not remove them."

OUTPUT — emit exactly this shape, nothing before the first marker, no code fences. Note ops BEFORE @@reply when editing:
@@thought <optional one short internal line, skip if unnecessary>
@@delete <sectionId>
@@highlight <sectionId> yellow
@@unhighlight <sectionId>
@@revise <sectionId>
<full section markdown>
@@append
<new section markdown>
@@reply
<student-facing markdown only — no protocol talk, no full notes dump>

Omit any action marker you are not using. @@reply is required.${style}`;
}

export type LectureChatTurn = { role: "user" | "assistant"; content: string };

export type LectureChatSection = {
  sectionId: string;
  markdown: string;
  studentEdited?: boolean;
};

export async function* streamLiveLectureChat(input: {
  message: string;
  history: LectureChatTurn[];
  sections: LectureChatSection[];
  lectureTitle?: string;
  rollingSummary?: string;
  notesText?: string;
  transcript?: string;
  deckText?: string;
  screenContext?: string;
  selectedText?: string;
  selectedSectionId?: string;
  visibleSectionId?: string;
  noteInstruction?: string;
  attachedPdfText?: string;
  attachedPdfName?: string;
  appendSectionId: string;
  userId?: string;
}): AsyncGenerator<LectureChatStreamEvent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield {
      type: "text",
      channel: "reply",
      delta: "Rose is not configured to chat right now.",
    };
    return;
  }

  const attachedPdfText = (input.attachedPdfText ?? "").trim();
  const attachedPdfName = (input.attachedPdfName ?? "").trim().slice(0, 200);
  const message =
    input.message.trim().slice(0, MAX_TURN_CHARS) ||
    (attachedPdfText
      ? `Look at this PDF${attachedPdfName ? ` (${attachedPdfName})` : ""}.`
      : "");
  if (!message) return;

  const sections = input.sections.slice(0, 60).map((s) => ({
    sectionId: s.sectionId.slice(0, 64),
    markdown: s.markdown.slice(0, MAX_SECTION_CHARS),
    studentEdited: Boolean(s.studentEdited),
  }));
  const allowed = new Set(sections.map((s) => s.sectionId));

  const sectionsBlock = sections
    .map((s) => {
      const tag = s.studentEdited
        ? `[SECTION ${s.sectionId}] (student has edited this — still rewrite it if they asked)`
        : `[SECTION ${s.sectionId}]`;
      return `${tag}\n${s.markdown}`;
    })
    .join("\n\n");

  const history = input.history
    .filter(
      (t) =>
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim()
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({
      role: t.role,
      content: t.content.slice(0, MAX_TURN_CHARS),
    }));

  const styleNote = (input.noteInstruction ?? "").trim().slice(0, 800);
  const selectedSectionId = (input.selectedSectionId ?? "").trim();
  const visibleSectionId = (input.visibleSectionId ?? "").trim();
  const preferredSectionId =
    selectedSectionId && allowed.has(selectedSectionId)
      ? selectedSectionId
      : visibleSectionId && allowed.has(visibleSectionId)
        ? visibleSectionId
        : undefined;
  const visibleSection =
    visibleSectionId && allowed.has(visibleSectionId)
      ? sections.find((s) => s.sectionId === visibleSectionId)
      : undefined;

  const historyBlock = history.length
    ? `CHAT SO FAR (student-facing text only — those replies did not include @@ markers. This turn you MUST emit the protocol, including @@revise/@@append/@@delete/@@highlight/@@unhighlight BEFORE @@reply if they asked to change the notes):\n${history
        .map((t) =>
          t.role === "user" ? `Student: ${t.content}` : `Rose: ${t.content}`
        )
        .join("\n")}`
    : null;

  const contextBlock = [
    input.lectureTitle
      ? `LECTURE: ${input.lectureTitle.slice(0, 200)}`
      : null,
    (input.rollingSummary ?? "").trim()
      ? `ROLLING SUMMARY:\n${input.rollingSummary!.trim().slice(0, 1_600)}`
      : null,
    sectionsBlock
      ? `CURRENT NOTE SECTIONS (the only ids you may @@delete / @@highlight / @@unhighlight / @@revise):\n\n${sectionsBlock}`
      : "CURRENT NOTE SECTIONS: (none yet — you may @@append if they ask to add notes)",
    (input.notesText ?? "").trim() && sections.length === 0
      ? `NOTES (plain text, no section ids — @@append only, do not @@delete/@@revise):\n${input.notesText!.trim().slice(0, MAX_NOTES_CHARS)}`
      : null,
    (input.transcript ?? "").trim()
      ? `LECTURE TRANSCRIPT (recent):\n${input.transcript!.trim().slice(0, MAX_TRANSCRIPT_CHARS)}`
      : "LECTURE TRANSCRIPT: (nothing captured yet)",
    (input.deckText ?? "").trim()
      ? `DECK SLIDES (uploaded lecture slides — answer questions about these even if they have not been spoken yet):\n${input.deckText!.trim().slice(0, MAX_DECK_CHARS)}`
      : null,
    attachedPdfText
      ? `ATTACHED PDF${attachedPdfName ? ` (${attachedPdfName})` : ""}:\n${attachedPdfText.slice(0, MAX_ATTACHED_PDF_CHARS)}`
      : null,
    (input.screenContext ?? "").trim()
      ? `ON-SCREEN CONTENT:\n${input.screenContext!.trim().slice(0, 1_800)}`
      : null,
    visibleSection
      ? `WHERE THE STUDENT IS LOOKING (notes currently on screen — use this for "this"/"that"/"here"/"the highlight" unless they selected text or named another section):\n[SECTION ${visibleSection.sectionId}${visibleSection.studentEdited ? " student-edited" : ""}]\n${visibleSection.markdown.slice(0, 800)}`
      : null,
    preferredSectionId
      ? `DEFAULT NOTE TARGET (use this id for "this"/"that"/"here"/"the selection"/"the highlight" unless they named another section):\n${preferredSectionId}`
      : null,
    (input.selectedText ?? "").trim()
      ? `STUDENT'S CURRENT NOTE SELECTION:\n${input.selectedText!.trim().slice(0, 2_000)}`
      : null,
    styleNote
      ? `STUDENT NOTE STYLE (honor in any @@revise/@@append markdown):\n${styleNote}`
      : null,
    historyBlock,
    `STUDENT MESSAGE:\n${message}`,
    "\nEmit the protocol now. Note ops BEFORE @@reply when this is an edit request. Describing the change in @@reply is not enough. If the question is outside the lecture, say so then still answer.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: contextBlock },
  ];

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4_500,
    temperature: 0.25,
    system: lectureChatSystem(input.noteInstruction),
    messages,
  });

  const parser = createLectureChatParser(
    allowed,
    input.appendSectionId,
    sections,
    preferredSectionId
  );

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      for (const ev of parser.push(event.delta.text)) yield ev;
    }
  }
  for (const ev of parser.flush()) yield ev;

  try {
    const final = await stream.finalMessage();
    recordAiUsage({
      model: MODEL,
      inputTokens: final.usage?.input_tokens,
      outputTokens: final.usage?.output_tokens,
      feature: "live-lecture-chat",
      userId: input.userId ?? null,
    });
  } catch {
    /* telemetry only */
  }
}
