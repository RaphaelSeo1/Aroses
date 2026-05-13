import Anthropic from "@anthropic-ai/sdk";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/lib/brand";
import type { CoursePayload } from "@/types/course";
import { isQuizMcq } from "@/types/course";
import type { MCQuestion } from "@/types/study";
import type { StudyChatTurn } from "@/types/study-chat";

const MODEL = "claude-sonnet-4-6";

export function buildStudyContextText(
  payload: CoursePayload,
  opts: { moduleId: number; quizOpen: boolean }
): string {
  const mod = payload.modules.find((m) => m.id === opts.moduleId);
  if (!mod) {
    return buildFullCourseContext(payload);
  }

  let s = "";
  s += `Course: ${payload.title}\n`;
  s += `Description: ${payload.description}\n\n`;
  s += `=== WHAT THE STUDENT IS VIEWING NOW ===\n`;
  s += `Module ${mod.id}: ${mod.title}\n`;
  if (opts.quizOpen) {
    s += `Screen: MODULE QUIZ — The student is answering mixed multiple-choice and short written questions for this module.\n`;
    s += `Help them understand concepts and reasoning. Do NOT reveal correct MC letters, sample answers, or reference_answer text for written prompts.\n\n`;
  } else {
    s += `Screen: LESSONS — The student is reading this module's lesson content.\n\n`;
  }

  for (const lesson of mod.lessons) {
    s += `## ${lesson.title}\n${lesson.content}\n`;
    for (const kt of lesson.key_terms) {
      s += `Key term — ${kt.term}: ${kt.definition}\n`;
    }
    for (const ex of lesson.examples) {
      s += `Example: ${ex}\n`;
    }
    s += "\n";
  }

  if (opts.quizOpen && mod.quiz.length > 0) {
    s += `Quiz prompts for this module (do not solve by naming keys or copying reference answers):\n`;
    for (const q of mod.quiz) {
      if (isQuizMcq(q)) {
        s += `- ${q.question}\n  Options: ${q.choices.join(" | ")}\n`;
      } else {
        s += `- ${q.question}\n  (short written response — do not provide a model answer)\n`;
      }
    }
  }

  return s.slice(0, 180_000);
}

/** Older “study pack” layout: summary + global MCQs */
export function buildLegacyStudyContext(
  summary: string,
  keyConcepts: string[],
  questions: MCQuestion[]
): string {
  let s =
    "=== STUDY MATERIAL (summary + practice questions from uploaded PDF) ===\n\n";
  s += `SUMMARY:\n${summary}\n\n`;
  if (keyConcepts.length > 0) {
    s += `KEY CONCEPTS:\n${keyConcepts.join(", ")}\n\n`;
  }
  s +=
    "PRACTICE MULTIPLE CHOICE (help with ideas only; do not reveal which option A–D is correct):\n";
  for (const q of questions) {
    s += `\n- ${q.question}\n  Choices: ${q.choices.join(" | ")}\n`;
  }
  return s.slice(0, 180_000);
}

function buildFullCourseContext(payload: CoursePayload): string {
  let s = `Course: ${payload.title}\nDescription: ${payload.description}\n\n`;
  for (const mod of payload.modules) {
    s += `\n--- Module ${mod.id}: ${mod.title} ---\n`;
    for (const lesson of mod.lessons) {
      s += `## ${lesson.title}\n${lesson.content}\n`;
      for (const kt of lesson.key_terms) {
        s += `${kt.term}: ${kt.definition}. `;
      }
      s += "\n";
    }
  }
  return s.slice(0, 180_000);
}

function buildVoiceSystem(contextText: string): string {
  return `You are ${AI_ASSISTANT_NAME}, the student's voice tutor inside ${APP_NAME}. The student is TALKING TO YOU OUT LOUD and your reply will be SPOKEN BACK to them via text-to-speech. Write like a real person speaks — not like a written essay or chatbot.

VOICE STYLE (very important):
- Start EVERY reply with a short, casual lead-in before any real content. Vary it so it never sounds canned. Examples: "Okay so,", "Yeah, so", "Hmm, let me think,", "Right, basically,", "Oh — good one, so", "Mm, alright,", "Honestly,", "Wait, okay so", "You know what,", "So like,", "Alright, so".
- Sprinkle in natural filler words sparingly: "like", "you know", "I mean", "basically", "kind of", "honestly". Don't overuse — 1 or 2 per reply, not every sentence.
- MIRROR the student's vocabulary, casualness, and energy. Listen to HOW they're talking, not just what they're asking. If they say "ngl I'm kinda lost", reply in the same register, not formal essay tone. If they're stressed, be reassuring. If they're hyped, match the energy.
- Use contractions ("you're", "we'll", "it's", "that's"). Use rhetorical asides like "right?", "you know?", "make sense?" occasionally.
- Keep it SHORT. 1–3 spoken sentences is the norm. Only go longer if they explicitly ask for depth or it's truly a layered question. Most replies should be under 40 words.
- NO markdown. No asterisks, bullets, headers, code fences, or LaTeX — none of that survives TTS. Plain spoken English only.
- Don't read URLs, long lists, or symbol-heavy formulas aloud — paraphrase them.

RULES:
- Answer ONLY using the CONTEXT below. If something isn't in the student's notes, say it naturally — e.g. "Honestly, that's not really in your notes — closest thing is [X], wanna check that out?".
- Never invent facts, citations, numbers, or sources that aren't in CONTEXT.
- If CONTEXT says the student is on a quiz screen, don't reveal which choice is correct or hand them sample answers — teach the underlying reasoning instead.
- Output ONLY the spoken reply as plain text. No JSON, no preamble, no labels, no quotes around it.

CONTEXT:
---
${contextText}
---`;
}

export async function* streamVoiceReply(
  contextText: string,
  messages: StudyChatTurn[]
): AsyncGenerator<string, void, void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({ apiKey });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 500,
    system: buildVoiceSystem(contextText),
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta" &&
      event.delta.text
    ) {
      yield event.delta.text;
    }
  }
}

export async function runStudyChat(
  contextText: string,
  messages: StudyChatTurn[]
): Promise<{ reply: string; action: unknown | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const system = `You are ${AI_ASSISTANT_NAME}, an expert but friendly tutor. The student is working inside ${APP_NAME} on course material that was generated from their own uploaded files.

Rules:
- Answer ONLY using the CONTEXT section below. If the answer is not there, say clearly that their materials don't cover it and point them to the closest related heading or module to re-read.
- Be concise unless they ask for depth. Use short paragraphs or bullet lists when helpful.
- Never invent citations, sources, or facts outside CONTEXT.
- If CONTEXT indicates the student is on a quiz screen, do not reveal correct multiple-choice letters or give away quiz keys; teach the underlying ideas instead.
- When the student asks to jump to another module or to find where a term is covered, you may request navigation by setting an ACTION in the JSON output.

Output format:
- Return ONLY valid JSON, no markdown fences.
- Shape: {"reply": string, "action": null | {"type":"navigate_to_module","moduleId":number,"reason"?:string} | {"type":"navigate_by_query","query":string}}
- "reply" should be the user-visible tutoring message.
- Use "navigate_by_query" when the user asks for a module about a term/concept but you are not sure which module id it is.

CONTEXT:
---
${contextText}
---`;

  const anthropic = new Anthropic({ apiKey });

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }

  const raw = block.text.trim();
  try {
    const parsed = JSON.parse(raw) as { reply?: unknown; action?: unknown };
    if (typeof parsed?.reply === "string") {
      return { reply: parsed.reply.trim(), action: parsed.action ?? null };
    }
  } catch {
    // fall through
  }
  return { reply: raw, action: null };
}
