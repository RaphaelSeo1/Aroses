/**
 * Tutor Session AI — conversational tutoring with optional reference
 * uploads. Distinct from `lib/ai/mentored.ts` (which is built around
 * a chunked lesson plan).
 *
 * Three entry points:
 *   - `runTutorTurnStream` — yields text deltas + a final meta event
 *     for one assistant turn. Drives the SSE route.
 *   - `summarizeUpload` — given extracted PDF text or an image
 *     buffer, returns a short summary used in the session prompt.
 *   - `generateRecap` — given the full session (transcript +
 *     uploads + notes), returns polished Notion-style markdown.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
} from "@/types/tutor-session";

const MODEL = process.env.ANTHROPIC_TUTOR_MODEL || "claude-sonnet-4-6";
const FAST_MODEL =
  process.env.ANTHROPIC_TUTOR_FAST_MODEL || "claude-haiku-4-5";

// ---------------------------------------------------------------------------
// 1. System prompt builder
// ---------------------------------------------------------------------------

const MODE_INSTRUCTIONS: Record<TutorSessionModeTag, string> = {
  exam_prep: `MODE: EXAM PREP. The student has an exam coming up. Move efficiently. Prioritize what's likely to be tested. Drill recall. Don't dwell on tangents. After each concept, fire a quick check question. Be encouraging but fast.`,
  homework_help: `MODE: HOMEWORK HELP. Walk through problems step by step. Don't just give the answer — ask the student what they've tried, then guide them through each step. After solving one, suggest a similar one to try on their own.`,
  concept_review: `MODE: CONCEPT REVIEW. Take time to build deep understanding. Use analogies. Connect ideas to things the student already knows. Pause for questions. Quality over speed.`,
  quiz_me: `MODE: QUIZ ME. Actively test the student. Ask one question at a time, give feedback after each answer, then escalate difficulty. Mix recall, application, and synthesis. Tell them their score periodically.`,
  exploring: `MODE: EXPLORING. Open conversation. Follow the student's curiosity. Don't push a curriculum. If they wander into a related topic, follow them. Be a thoughtful conversation partner.`,
};

export function buildTutorSystemPrompt(input: {
  modeTag: TutorSessionModeTag | null;
  topic: string;
  referenceSummary: string;
  discussionSummary: string;
  /** When true, Rose should emit notesAppend in META for teaching turns. */
  autoGenerateNotes?: boolean;
  /** When true, the student explicitly asked to save content to notes. */
  explicitNotesRequest?: boolean;
  /** Verbatim text Rose had spoken before a barge-in interruption. */
  interruptedAfter?: string;
  /** Remaining reply Rose had generated but not spoken yet. */
  notYetSpoken?: string;
}): string {
  const modeBlock = input.modeTag ? MODE_INSTRUCTIONS[input.modeTag] : "";
  const topicBlock = input.topic.trim()
    ? `\n\nSTUDENT'S OPENING TOPIC: "${input.topic.trim().slice(0, 600)}"`
    : "";
  const referenceBlock = input.referenceSummary.trim()
    ? `\n\nREFERENCE MATERIALS THE STUDENT UPLOADED (CONTEXT — not a course you need to teach systematically; use to ground your explanations, match the professor's framing, and reference specific parts when relevant):\n"""\n${input.referenceSummary.trim().slice(0, 4000)}\n"""`
    : "";
  const discussionBlock = input.discussionSummary.trim()
    ? `\n\nWHAT YOU HAVE ALREADY COVERED IN THIS SESSION (running summary — treat as ground truth for session memory):
${input.discussionSummary.trim().slice(0, 2800)}

CONTINUITY RULES (strict):
- If a concept is listed above or appears in recent transcript, the student ALREADY heard your explanation. Do NOT re-teach it from scratch.
- When a new topic connects to something earlier, reference it briefly ("remember Sarbanes-Oxley from earlier?") and build forward — one sentence max, then new material.
- Only re-explain a prior concept if the student explicitly asks ("can you explain X again?", "I forgot that part") or clearly shows they don't understand.`
    : "";

  const notesBlock =
    input.explicitNotesRequest || input.autoGenerateNotes
      ? `\n\nSTUDENT NOTES PANEL:
The student has a live notes doc beside this chat. Notes are synthesized automatically from your spoken explanation — do NOT try to write notes in META.${
          input.explicitNotesRequest
            ? " They just asked you to save key concepts — acknowledge briefly in speech (e.g. \"Got it — adding that to your notes\") then teach normally."
            : " Auto-generate is ON — teach substantively; their notes will be written separately."
        }
Always set "notesAppend" to null in META.`
      : `\n\nSTUDENT NOTES: If the student asks to add something to their notes, acknowledge briefly in speech. Notes are synthesized separately — always set "notesAppend" to null in META.`;

  const interruptedBlock =
    input.interruptedAfter && input.interruptedAfter.trim().length > 0
      ? `

INTERRUPTION: The student cut you off mid-sentence. You had already said part of your reply out loud; the rest was generated but NOT spoken yet.

ALREADY SPOKEN (they heard this — do NOT repeat any of it):
"""
${input.interruptedAfter.trim().slice(0, 800)}
"""${
          input.notYetSpoken && input.notYetSpoken.trim().length > 0
            ? `

NOT YET SPOKEN (they did NOT hear this — you may continue from here ONLY if they ask to resume; otherwise move on):
"""
${input.notYetSpoken.trim().slice(0, 800)}
"""`
            : ""
        }

How to respond:
1. Briefly acknowledge the interruption, then address their new message.
2. Do NOT re-explain concepts from ALREADY SPOKEN or from earlier in this session unless they explicitly ask you to repeat.
3. Only offer to resume the NOT YET SPOKEN portion if they clearly want you to continue — never loop the same offer every turn.`
      : "";

  return `You are Rose, running a one-on-one tutor session with a student. This is NOT a course — there is no pre-built lesson plan. Adapt to whatever the student wants to work on right now.

CORE BEHAVIOR:
- Talk like a real human tutor. Warm, focused, curious about the student's thinking. No corporate filler, no "as an AI", no apologizing.
- Spoken-style replies: 1-4 sentences typical, longer only when explaining something complex. Avoid markdown in spoken responses (no bullet stars, no #).
- When the student's request is vague ("help me with calc"), ask ONE clarifying question — never a wall of them.
- Pace based on context. If they're in exam prep, move efficiently. If exploring, take time to go deep.
- Periodically check understanding — every 2-3 explanations, not every sentence.
- You can ask questions, present problems, run mini-quizzes, or just explain — whichever fits.
- ALWAYS be encouraging. Never make the student feel stupid for not knowing something.
- MEMORY: Read the conversation history and discussion summary. Do NOT re-teach concepts you already explained in this session unless the student asks you to repeat or clearly did not understand. When revisiting an earlier topic, assume they remember it and connect forward — don't restart the lecture.

QUESTION SCOPE RULES (strict):
- Only ask about content YOU have just explained OR that's in the uploaded reference materials. Don't pop quiz on random adjacent topics.
- Don't ask application questions unless you've walked through at least one applied example first.
- Match question difficulty to what was actually covered.${topicBlock}${referenceBlock}${discussionBlock}${notesBlock}${interruptedBlock}${modeBlock ? `\n\n${modeBlock}` : ""}

OUTPUT FORMAT (STRICT):
1. First, your spoken reply as plain text. No markdown formatting.
2. Then on a new line, write exactly: <<<META>>>
3. Then on a new line, emit a JSON object:
{"intent":"answer|teach|clarify|question|wrap_up|other","imageRequest":{"query":"<short noun phrase>","type":"diagram"|"photo"|"illustration"}|null,"notesAppend":{"heading":"...","intro":"...","bullets":[{"text":"...","bold":"Term"}],"vocabulary":[{"term":"...","definition":"..."}],"callout":{"emoji":"💡","text":"..."}}|null}

Set imageRequest sparingly — only when a visual would genuinely help OR the student explicitly asked. Never for grammar/abstract/math equations.
Always set notesAppend to null (notes are synthesized server-side).`;
}

// ---------------------------------------------------------------------------
// 2. Conversational turn streaming
// ---------------------------------------------------------------------------

const TUTOR_META_SENTINEL = "<<<META>>>";

export type TutorTurnInput = {
  modeTag: TutorSessionModeTag | null;
  topic: string;
  referenceSummary: string;
  discussionSummary: string;
  /** Prior messages, oldest-first. We trim if too long. */
  history: TutorSessionMessage[];
  studentUtterance: string;
  autoGenerateNotes?: boolean;
  explicitNotesRequest?: boolean;
  /** What Rose had already spoken aloud before the student barged in. */
  interruptedAfter?: string;
  /** Generated text Rose had not spoken yet when interrupted. */
  notYetSpoken?: string;
};

export type TutorTurnImageRequest = {
  query: string;
  type: "diagram" | "photo" | "illustration";
};

/** Structured block appended to the student's live notes panel. */
export type TutorNotesAppend = {
  heading?: string;
  intro?: string;
  bullets?: Array<string | { text: string; bold?: string }>;
  vocabulary?: Array<{ term: string; definition?: string }>;
  callout?: { emoji?: string; text: string };
};

export type TutorTurnEvent =
  | { type: "text"; delta: string }
  | {
      type: "meta";
      intent: string;
      imageRequest: TutorTurnImageRequest | null;
      notesAppend: TutorNotesAppend | null;
    };

function stripJsonFence(s: string): string {
  return s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
}

function parseNotesAppend(raw: unknown): TutorNotesAppend | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bulletsRaw = o.bullets;
  const bullets: TutorNotesAppend["bullets"] = [];
  if (Array.isArray(bulletsRaw)) {
    for (const item of bulletsRaw) {
      if (typeof item === "string" && item.trim()) {
        bullets.push(item.trim());
      } else if (item && typeof item === "object") {
        const b = item as Record<string, unknown>;
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (!text) continue;
        const bold = typeof b.bold === "string" ? b.bold.trim() : undefined;
        bullets.push(bold ? { text, bold } : { text });
      }
    }
  }
  const vocabulary: TutorNotesAppend["vocabulary"] = [];
  if (Array.isArray(o.vocabulary)) {
    for (const v of o.vocabulary) {
      if (!v || typeof v !== "object") continue;
      const row = v as Record<string, unknown>;
      const term = typeof row.term === "string" ? row.term.trim() : "";
      if (!term) continue;
      vocabulary.push({
        term,
        definition:
          typeof row.definition === "string" ? row.definition.trim() : undefined,
      });
    }
  }
  let callout: TutorNotesAppend["callout"];
  if (o.callout && typeof o.callout === "object") {
    const c = o.callout as Record<string, unknown>;
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (text) {
      callout = {
        emoji: typeof c.emoji === "string" ? c.emoji : undefined,
        text,
      };
    }
  }
  const heading =
    typeof o.heading === "string" ? o.heading.trim().slice(0, 120) : undefined;
  const intro =
    typeof o.intro === "string" ? o.intro.trim().slice(0, 400) : undefined;
  if (!heading && bullets.length === 0 && vocabulary.length === 0 && !callout) {
    return null;
  }
  return {
    heading,
    intro,
    bullets: bullets.length > 0 ? bullets : undefined,
    vocabulary: vocabulary.length > 0 ? vocabulary : undefined,
    callout,
  };
}

function parseTutorMeta(raw: string): {
  intent: string;
  imageRequest: TutorTurnImageRequest | null;
  notesAppend: TutorNotesAppend | null;
} {
  const trimmed = stripJsonFence(raw).trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { intent: "other", imageRequest: null, notesAppend: null };
  }
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const intent =
      typeof obj.intent === "string" ? obj.intent.slice(0, 24) : "other";
    let imageRequest: TutorTurnImageRequest | null = null;
    if (obj.imageRequest && typeof obj.imageRequest === "object") {
      const ir = obj.imageRequest as Record<string, unknown>;
      const q = typeof ir.query === "string" ? ir.query.trim() : "";
      const t =
        ir.type === "diagram" || ir.type === "photo" || ir.type === "illustration"
          ? ir.type
          : "illustration";
      if (q.length >= 3 && q.length <= 80) imageRequest = { query: q, type: t };
    }
    const notesAppend = parseNotesAppend(obj.notesAppend);
    return { intent, imageRequest, notesAppend };
  } catch {
    return { intent: "other", imageRequest: null, notesAppend: null };
  }
}

/**
 * Yields text deltas (no meta sentinel leakage), then a final meta event.
 *
 * Implementation notes:
 *   - Trims history to the last 20 turns to bound prompt size. Older
 *     context lives in `discussionSummary` (refreshed periodically
 *     elsewhere).
 *   - Streams tokens via Anthropic's `stream:true` API.
 */
export async function* runTutorTurnStream(
  input: TutorTurnInput
): AsyncGenerator<TutorTurnEvent, void, void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const system = buildTutorSystemPrompt({
    modeTag: input.modeTag,
    topic: input.topic,
    referenceSummary: input.referenceSummary,
    discussionSummary: input.discussionSummary,
    autoGenerateNotes: input.autoGenerateNotes,
    explicitNotesRequest: input.explicitNotesRequest,
    interruptedAfter: input.interruptedAfter,
    notYetSpoken: input.notYetSpoken,
  });

  const trimmedHistory = input.history.slice(-32);
  const messages = [
    ...trimmedHistory.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: input.studentUtterance },
  ];

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const stream = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 700,
    temperature: 0.6,
    system,
    messages,
  });

  let buffered = "";
  let textForwardedUpTo = 0;
  let inMeta = false;

  for await (const evt of stream) {
    if (
      evt.type === "content_block_delta" &&
      "delta" in evt &&
      evt.delta.type === "text_delta"
    ) {
      buffered += evt.delta.text;
      if (!inMeta) {
        const idx = buffered.indexOf(TUTOR_META_SENTINEL);
        if (idx >= 0) {
          const tail = buffered.slice(textForwardedUpTo, idx);
          if (tail) yield { type: "text", delta: tail };
          inMeta = true;
          textForwardedUpTo = idx + TUTOR_META_SENTINEL.length;
        } else {
          const safeUpTo = Math.max(textForwardedUpTo, buffered.length - 16);
          if (safeUpTo > textForwardedUpTo) {
            yield { type: "text", delta: buffered.slice(textForwardedUpTo, safeUpTo) };
            textForwardedUpTo = safeUpTo;
          }
        }
      }
    }
  }

  if (!inMeta) {
    const tail = buffered.slice(textForwardedUpTo);
    if (tail) yield { type: "text", delta: tail };
    yield { type: "meta", intent: "other", imageRequest: null, notesAppend: null };
    return;
  }
  const metaSlice = buffered.slice(textForwardedUpTo);
  const meta = parseTutorMeta(metaSlice);
  yield {
    type: "meta",
    intent: meta.intent,
    imageRequest: meta.imageRequest,
    notesAppend: meta.notesAppend,
  };
}

// ---------------------------------------------------------------------------
// 3. Upload summarization (PDF text or image bytes via Claude vision)
// ---------------------------------------------------------------------------

const UPLOAD_SUMMARY_SYSTEM = `You are summarizing a piece of reference material a student uploaded for their tutor session. Produce a TIGHT, useful summary the tutor can read in 5 seconds before deciding how to help.

Output a plain-text summary, 4-8 sentences max. Cover:
- What kind of document this is (lecture notes, practice exam, problem set, textbook chapter, handwritten homework, etc.)
- The topic/subject area
- Key concepts, formulas, or problems present
- The professor's framing or terminology if it's distinctive (so the tutor can match it)

No markdown. No bullet points. Just clean prose.`;

export async function summarizePdfUpload(input: {
  fileName: string;
  extractedText: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return `(${input.fileName} — summary unavailable)`;
  const trimmed = input.extractedText.slice(0, 30_000);
  try {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 350,
      temperature: 0.3,
      system: UPLOAD_SUMMARY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `FILENAME: ${input.fileName}\n\nEXTRACTED TEXT:\n"""\n${trimmed}\n"""\n\nSummarize.`,
        },
      ],
    });
    const block = msg.content.find((b) => b.type === "text");
    return block && block.type === "text"
      ? block.text.trim().slice(0, 1200)
      : `(${input.fileName})`;
  } catch (e) {
    console.error("[summarizePdfUpload]", e);
    return `(${input.fileName})`;
  }
}

export async function summarizeImageUpload(input: {
  fileName: string;
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return `(${input.fileName} — summary unavailable)`;
  try {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 500,
      temperature: 0.3,
      system:
        UPLOAD_SUMMARY_SYSTEM +
        "\n\nFor handwritten or photographed work, transcribe key text + describe equations / diagrams / problems. If unclear in spots, note that.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType,
                data: input.imageBase64,
              },
            },
            {
              type: "text",
              text: `FILENAME: ${input.fileName}\n\nWhat's in this image? Summarize for a tutor.`,
            },
          ],
        },
      ],
    });
    const block = msg.content.find((b) => b.type === "text");
    return block && block.type === "text"
      ? block.text.trim().slice(0, 1500)
      : `(${input.fileName})`;
  } catch (e) {
    console.error("[summarizeImageUpload]", e);
    return `(${input.fileName})`;
  }
}

// ---------------------------------------------------------------------------
// 4. Session title generation
// ---------------------------------------------------------------------------

export async function generateSessionTitle(input: {
  topic: string;
  referenceSummary: string;
  modeTag: TutorSessionModeTag | null;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return input.topic.slice(0, 60) || "Untitled session";
  // Cheap heuristic when there's no context at all.
  if (!input.topic.trim() && !input.referenceSummary.trim()) {
    return "Open tutor session";
  }
  try {
    const anthropic = new Anthropic({ apiKey, timeout: 10_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 40,
      temperature: 0.3,
      system: `Generate a SHORT title (4-8 words) for a tutor session. Capitalize like a Title. No emoji, no quotes. Output ONLY the title.`,
      messages: [
        {
          role: "user",
          content: `Mode: ${input.modeTag ?? "open"}\nStudent topic: ${input.topic.trim() || "(none)"}\nReference summary: ${input.referenceSummary.trim().slice(0, 600) || "(none)"}\n\nTitle:`,
        },
      ],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return "Tutor session";
    return (
      block.text
        .replace(/[\n"`]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Tutor session"
    );
  } catch {
    return input.topic.slice(0, 60) || "Tutor session";
  }
}

// ---------------------------------------------------------------------------
// 5. Running discussion-summary refresh (cheap Haiku call)
// ---------------------------------------------------------------------------

export async function refreshDiscussionSummary(input: {
  previousSummary: string;
  recentMessages: TutorSessionMessage[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return input.previousSummary;
  const recent = input.recentMessages
    .map(
      (m) =>
        `${m.role === "user" ? "STUDENT" : "ROSE"}: ${m.content.slice(0, 500)}`
    )
    .join("\n\n")
    .slice(0, 8000);
  try {
    const anthropic = new Anthropic({ apiKey, timeout: 15_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 500,
      temperature: 0.2,
      system: `You maintain a running summary of what an AI tutor and their student have discussed in a tutor session.

Output format (plain text, no markdown headings):
CONCEPTS COVERED (do not re-teach these):
- bullet list of every substantive concept, law, mechanism, or definition explained so far

RECENT FLOW:
- 2-4 bullets on what topics were discussed most recently and where the conversation left off

RULES:
- MERGE with the previous summary — never drop concepts from earlier in the session.
- Add new concepts from recent exchanges; keep prior ones unless the student explicitly replaced them.
- Ignore pleasantries, check-ins, and session logistics.
- Be specific (e.g. "Sarbanes-Oxley CEO/CFO certification" not "accounting rules").`,
      messages: [
        {
          role: "user",
          content: `PREVIOUS SUMMARY:\n${input.previousSummary || "(none yet)"}\n\nRECENT EXCHANGES:\n${recent}\n\nUPDATED SUMMARY:`,
        },
      ],
    });
    const block = msg.content.find((b) => b.type === "text");
    return block && block.type === "text"
      ? block.text.trim().slice(0, 2800)
      : input.previousSummary;
  } catch (e) {
    console.error("[refreshDiscussionSummary]", e);
    return input.previousSummary;
  }
}

// ---------------------------------------------------------------------------
// 6. End-of-session recap generation
// ---------------------------------------------------------------------------

const RECAP_SYSTEM = `You generate a polished, study-ready RECAP from a tutor session transcript. Output MARKDOWN — proper headings, bullets, callouts, bold for key terms.

STRUCTURE (use this EXACTLY):

# {Emoji} {Title}

> *{Mode tag if any} · {Approx duration} · {Date}*

## Overview
{2-3 sentence summary of what the session covered and what the student now understands better.}

## What we covered
{For each major topic, an H3 section. Under each:
- Brief concept explanation (1-2 sentences)
- A bullet list of key takeaways, with **bold** lead-ins for key terms
- Worked examples if discussed (use code blocks for formulas / equations)
- A > callout block for any "remember this" moment
}

## Key terms
{A definition list of important terms surfaced in the session. Format as:
- **Term** — definition.}

## Self-check questions
{3-5 questions the student can use to verify retention later. Mix of conceptual and applied.}

## What to study next
{2-4 specific next steps tied to gaps you noticed in the conversation OR natural follow-up topics. Each as a bullet starting with a verb.}

STYLE RULES:
- Polished but warm. Sound like a thoughtful TA wrote the recap.
- Concise — better tight and readable than long and waffly.
- NO generic filler. Every section should be specific to what the student actually discussed.
- Use ONE emoji in the H1 title that matches the topic.
- Skip sections that aren't relevant (e.g. no "Worked examples" if none were discussed).`;

export async function generateRecap(input: {
  title: string;
  modeTag: TutorSessionModeTag | null;
  durationSeconds: number | null;
  startedAt: string;
  transcript: TutorSessionMessage[];
  referenceSummary: string;
  liveNotesText: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const duration =
    input.durationSeconds && input.durationSeconds > 0
      ? `${Math.round(input.durationSeconds / 60)} min`
      : "—";
  const dateStr = new Date(input.startedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const transcriptText = input.transcript
    .map(
      (m) => `${m.role === "user" ? "STUDENT" : "ROSE"}: ${m.content.trim()}`
    )
    .join("\n\n")
    .slice(0, 30_000);

  const userPrompt = `TITLE HINT: ${input.title}
MODE: ${input.modeTag ?? "open exploration"}
DURATION: ${duration}
DATE: ${dateStr}

REFERENCE MATERIALS SUMMARY:
${input.referenceSummary.trim() || "(none uploaded)"}

LIVE NOTES THE STUDENT TOOK:
"""
${input.liveNotesText.trim().slice(0, 4000) || "(none)"}
"""

FULL TRANSCRIPT:
"""
${transcriptText}
"""

Generate the recap now. Start with the H1 title.`;

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2500,
    temperature: 0.4,
    system: RECAP_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Empty recap response");
  }
  return block.text.trim();
}
