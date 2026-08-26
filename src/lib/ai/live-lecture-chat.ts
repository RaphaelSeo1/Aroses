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
const MAX_SECTION_CHARS = 1_800;

const SYSTEM = `You are Rose, sitting next to a student during a live lecture. They can ask questions about what was just taught, and they can ask you to change the notes on the left.

GROUNDING (critical):
- Answer from CURRENT NOTES, LECTURE TRANSCRIPT, optional DECK SLIDES, and optional ON-SCREEN CONTENT.
- If the lecture has not covered it, say so. Do not invent textbook chapters, citations, or formulas that are not in those sources.
- You MAY briefly clarify a term the lecturer used but did not define, and mark that as your gloss — not as something said in class.
- Spellings, symbols, numbers, and table cells: prefer slides / on-screen text over garbled speech-to-text.

@@reply (always):
- Write a helpful, concise answer to the student in markdown. Warm, direct, not a transcript dump.
- If you also edit notes, end the reply with one short sentence of what you changed ("Highlighted the demand curve definition." / "Removed the draft on elasticity." / "Added a section on deadweight loss.").
- Do not mention section ids, @@ markers, or this protocol in the reply.

NOTE EDITS — only when they asked you to change the notes (add, delete, rewrite, expand, highlight, bold-important, "put that in the notes", "take that out", etc.). Mere questions do not edit notes.
- CURRENT NOTE SECTIONS lists the only ids you may touch. Never invent an id.
- "that" / "this" / "the last one" / selected text → the best-matching section (heading + body). Prefer the most recent section if still ambiguous.
- @@delete <sectionId> — remove a whole AI section they want gone. Do not delete student-written material (it will not be in the list).
- @@highlight <sectionId> [yellow|green|blue|pink|purple|orange] — mark that section so it stands out. Default yellow.
- @@revise <sectionId> then the FULL rewritten section markdown — use to add more, fix, shorten, or rewrite that section. Keep correct existing content unless they asked to replace it.
- @@append then new markdown — add a NEW section (new topic, or extra material that does not belong under an existing heading).
- Notes markdown: "## " headings, "- " bullets (one nest), "1. " steps, **bold** key terms, GFM tables. Match the existing note style. Do not copy the transcript verbatim.
- Per turn caps: at most 3 @@delete, 3 @@highlight, 1 @@revise, 1 @@append.
- Never emit @@revise/@@append unless you are actually changing notes.

OUTPUT — emit exactly this shape, nothing before the first marker, no code fences:
@@thought <optional one short activity line, skip if unnecessary>
@@reply
<student-facing markdown>
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

  const message = input.message.trim().slice(0, MAX_TURN_CHARS);
  if (!message) return;

  const sections = input.sections.slice(0, 40).map((s) => ({
    sectionId: s.sectionId.slice(0, 64),
    markdown: s.markdown.slice(0, MAX_SECTION_CHARS),
  }));
  const allowed = new Set(sections.map((s) => s.sectionId));

  const sectionsBlock = sections
    .map(
      (s) =>
        `[SECTION ${s.sectionId}]\n${s.markdown}`
    )
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
    (input.screenContext ?? "").trim()
      ? `ON-SCREEN CONTENT:\n${input.screenContext!.trim().slice(0, 1_800)}`
      : null,
    (input.selectedText ?? "").trim()
      ? `STUDENT'S CURRENT NOTE SELECTION:\n${input.selectedText!.trim().slice(0, 2_000)}`
      : null,
    styleNote
      ? `HOW THE STUDENT WANTS NOTES WRITTEN:\n${styleNote}`
      : null,
    `STUDENT MESSAGE:\n${message}`,
    "\nEmit the protocol now. @@reply first. Edit notes only if they asked.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({
      role: t.role,
      content: t.content,
    })),
    { role: "user", content: contextBlock },
  ];

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 3_500,
    temperature: 0.4,
    system: SYSTEM,
    messages,
  });

  const parser = createLectureChatParser(allowed, input.appendSectionId);

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
