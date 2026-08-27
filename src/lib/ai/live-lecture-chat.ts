import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import {
  createLectureChatParser,
  type LectureChatStreamEvent,
} from "@/lib/live-notes/lecture-chat-protocol";

export type { LectureChatStreamEvent } from "@/lib/live-notes/lecture-chat-protocol";

const MODEL =
  process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || "claude-haiku-4-5";

const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 4_000;
const MAX_NOTES_CHARS = 24_000;
const MAX_TRANSCRIPT_CHARS = 10_000;
const MAX_DECK_CHARS = 8_000;
const MAX_ATTACHED_PDF_CHARS = 16_000;
const MAX_SECTION_CHARS = 4_000;

const SYSTEM = `You are Rose, sitting next to a student during a live lecture. They can ask questions about what was just taught, and they can ask you to change the notes on the left.

GROUNDING (critical):
- Answer from CURRENT NOTES, LECTURE TRANSCRIPT, optional DECK SLIDES, optional ON-SCREEN CONTENT, and optional ATTACHED PDF (a handout/worksheet/problem set the student shared in chat — not the lecture deck).
- Prefer the attached PDF when they ask about that file, a worksheet, problems, or "this PDF".
- If the lecture has not covered it and it is not in the attached PDF, say so. Do not invent textbook chapters, citations, or formulas that are not in those sources.
- You MAY briefly clarify a term the lecturer used but did not define, and mark that as your gloss — not as something said in class.
- Spellings, symbols, numbers, and table cells: prefer slides / on-screen text / attached PDF over garbled speech-to-text.

@@thought (optional — INTERNAL ONLY, never student-facing):
- One short line of protocol narration: what you will edit, which op you will emit.
- Never chain-of-thought, self-critique, or "I should have used @@revise". Skip if unnecessary.

@@reply (required — the ONLY text the student reads):
- ONLY the answer they should see. Warm, direct, markdown. Not a transcript dump.
- If you also edit notes, end with one short sentence of what you changed ("Simplified the scarcity wording." / "Highlighted the demand curve definition." / "Removed the draft on elasticity.").
- Never chain-of-thought. Never "I should @@revise". Never admit you failed to emit markers. Never mention section ids, @@ markers, or this protocol.
- Put NO prose before the first @@ marker and NO reasoning before @@reply. Reasoning belongs in @@thought or nowhere.

NOTE EDITS — you MUST act, not just talk:
If the student asks to change, fix, reword, rewrite, simplify, shorten, expand, add, delete, highlight, bold, correct, or "make it X" regarding the notes, you MUST emit @@revise / @@append / @@delete / @@highlight. Writing the new wording only inside @@reply does not change the notes. That is a failure.
- Questions ("what is X?", "did they say Y?") → @@reply only. No note edits.
- Edit requests ("fix the wording", "change that to…", "make this simpler", "rephrase the scarcity section", "add this to the notes", "add this PDF / these problems", "delete that", "highlight this") → @@reply AND the matching note op.
- CURRENT NOTE SECTIONS lists the only ids you may touch. Copy the id exactly from [SECTION …]. Never invent an id.
- "that" / "this" / "the last one" / selected text → the best-matching section (heading + body). Prefer the most recent section if still ambiguous.
- Student-edited sections are still fair game when the student asked you to change them.
- @@delete <sectionId> — remove a whole section they want gone.
- @@highlight <sectionId> [yellow|green|blue|pink|purple|orange] — mark that section so it stands out. Default yellow.
- @@revise <sectionId> then the FULL rewritten section markdown — use to add more, fix wording, shorten, or rewrite that section. Keep correct existing content unless they asked to replace it. The replacement must be complete (heading + body), not a fragment.
- @@append then new markdown — add a NEW section (new topic, or extra material that does not belong under an existing heading).
- Notes markdown: "## " headings, "- " bullets (one nest), "1. " steps, **bold** key terms, GFM tables. Match the existing note style. Do not copy the transcript verbatim.
- Per turn caps: at most 3 @@delete, 3 @@highlight, 3 @@revise, 1 @@append.

Example — student: "fix the wording on scarcity, make it simpler"
@@thought Revising the scarcity section.
@@reply
Simplified the scarcity section.
@@revise s-1a2b3c
## Scarcity
- Resources are limited, so every choice has a trade-off.

Never put this in @@reply (it is thinking, not an answer): "The student is right—I never actually used @@revise…" / "I should emit @@revise now."

OUTPUT — emit exactly this shape, nothing before the first marker, no code fences:
@@thought <optional one short internal line, skip if unnecessary>
@@reply
<student-facing markdown only — no protocol talk>
@@delete <sectionId>
@@highlight <sectionId> yellow
@@revise <sectionId>
<full section markdown>
@@append
<new section markdown>

Omit any action marker you are not using. @@reply is required.`;

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

  const historyBlock = history.length
    ? `CHAT SO FAR (student-facing text only — those replies did not include @@ markers. This turn you MUST emit the protocol, including @@revise/@@append/@@delete/@@highlight if they asked to change the notes):\n${history
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
      ? `CURRENT NOTE SECTIONS (the only ids you may @@delete / @@highlight / @@revise):\n\n${sectionsBlock}`
      : "CURRENT NOTE SECTIONS: (none yet — you may @@append if they ask to add notes)",
    (input.notesText ?? "").trim() && sections.length === 0
      ? `NOTES (plain text, no section ids — @@append only, do not @@delete/@@revise):\n${input.notesText!.trim().slice(0, MAX_NOTES_CHARS)}`
      : null,
    (input.transcript ?? "").trim()
      ? `LECTURE TRANSCRIPT (recent):\n${input.transcript!.trim().slice(0, MAX_TRANSCRIPT_CHARS)}`
      : "LECTURE TRANSCRIPT: (nothing captured yet)",
    (input.deckText ?? "").trim()
      ? `DECK SLIDES:\n${input.deckText!.trim().slice(0, MAX_DECK_CHARS)}`
      : null,
    attachedPdfText
      ? `ATTACHED PDF${attachedPdfName ? ` (${attachedPdfName})` : ""}:\n${attachedPdfText.slice(0, MAX_ATTACHED_PDF_CHARS)}`
      : null,
    (input.screenContext ?? "").trim()
      ? `ON-SCREEN CONTENT:\n${input.screenContext!.trim().slice(0, 1_800)}`
      : null,
    (input.selectedText ?? "").trim()
      ? `STUDENT'S CURRENT NOTE SELECTION:\n${input.selectedText!.trim().slice(0, 2_000)}`
      : null,
    styleNote
      ? `HOW THE STUDENT WANTS NOTES WRITTEN:\n${styleNote}`
      : null,
    historyBlock,
    `STUDENT MESSAGE:\n${message}`,
    "\nEmit the protocol now. @@reply is required. If this message is an edit request, @@revise/@@append/@@delete/@@highlight is also required — describing the change in @@reply is not enough.",
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
    system: SYSTEM,
    messages,
  });

  const parser = createLectureChatParser(
    allowed,
    input.appendSectionId,
    sections
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
