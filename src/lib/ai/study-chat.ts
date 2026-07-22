import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import { formatSelfStudyTutorBlock } from "@/lib/self-study-context";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/lib/brand";
import { parseStudyChatResponse } from "@/lib/ai/study-chat-parse";
import type { CoursePayload } from "@/types/course";
import { isQuizMcq } from "@/types/course";
import type { MCQuestion } from "@/types/study";
import type { StudyChatTurn } from "@/types/study-chat";

const MODEL = "claude-sonnet-4-6";

export type StudyCourseMapEntry = {
  materialId: string;
  label: string;
  modules: { id: number; title: string; lessonTitles: string[] }[];
};

export function buildCourseMapSection(entries: StudyCourseMapEntry[]): string {
  if (entries.length === 0) return "";
  let s = "=== FULL COURSE MAP (all uploads / modules — use for navigation & cross-module questions) ===\n";
  for (const entry of entries) {
    s += `\nUpload “${entry.label}” (materialId: ${entry.materialId}):\n`;
    for (const mod of entry.modules) {
      const lessons =
        mod.lessonTitles.length > 0
          ? ` — lessons: ${mod.lessonTitles.join("; ")}`
          : "";
      s += `  • Module ${mod.id}: ${mod.title}${lessons}\n`;
    }
  }
  return `${s}\n`;
}

export function buildStudyContextText(
  payload: CoursePayload,
  opts: {
    moduleId: number;
    quizOpen: boolean;
    courseMap?: StudyCourseMapEntry[];
    currentMaterialId?: string;
  }
): string {
  const mod = payload.modules.find((m) => m.id === opts.moduleId);
  if (!mod) {
    return buildFullCourseContext(payload);
  }

  let s = "";
  s += `Course: ${payload.title}\n`;
  s += `Description: ${payload.description}\n\n`;

  if (opts.courseMap && opts.courseMap.length > 0) {
    s += buildCourseMapSection(opts.courseMap);
  } else {
    s += "=== MODULE INDEX (this upload) ===\n";
    for (const m of payload.modules) {
      const lessons = m.lessons.map((l) => l.title).join("; ");
      s += `  • Module ${m.id}: ${m.title}${lessons ? ` — ${lessons}` : ""}\n`;
    }
    s += "\n";
  }

  if (opts.currentMaterialId) {
    s += `Current upload materialId: ${opts.currentMaterialId}\n\n`;
  }

  s += `=== WHAT THE STUDENT IS VIEWING NOW ===\n`;
  s += `Module ${mod.id}: ${mod.title}\n`;
  if (opts.quizOpen) {
    s += `Screen: MODULE QUIZ — The student is actively answering questions for this module.\n`;
    s += `Coach them on concepts and reasoning. Do NOT read out the correct MCQ letter or paste the stored reference answer — but DO explain ideas, walk through similar examples, and help them think.\n\n`;
  } else {
    s += `Screen: LESSONS — The student is reading this module's lesson content.\n`;
    s += `They may ask about other modules, exam prep, or quiz-style practice — help fully using the course map and lesson content below.\n\n`;
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

/** When the student barges in while TTS is playing, we re-call the model with this hint. */
export type VoiceContinuationHint = {
  spokenBeforeInterrupt: string;
  notYetSpoken: string;
  /** True if the SSE stream was still receiving tokens when they interrupted. */
  streamIncomplete?: boolean;
};

function voiceInterruptionAddendum(h: VoiceContinuationHint): string {
  const spoken = h.spokenBeforeInterrupt.trim();
  const tail = h.notYetSpoken.trim();
  const partial = h.streamIncomplete
    ? " (The full reply may not have finished generating yet.)"
    : "";
  return `

INTERRUPTION / BARGE-IN (voice session):
The student started talking while you were mid-reply. Treat their NEW last message as an interruption, not a brand-new topic unless they clearly changed subjects.

Already spoken aloud (verbatim, do not repeat unless they ask you to): ${JSON.stringify(spoken)}
Not yet spoken from your previous reply (preserve this mentally; you may resume it later): ${JSON.stringify(tail)}${partial}

How to respond:
- Sound calm and human — never annoyed, robotic, or defensive about being cut off.
- If they ask you to repeat / "say that again" / "what was that": replay the last sentence or two from the spoken portion, then naturally continue with the not-yet-spoken part using a bridge like "okay so picking back up" or "anyway, so what I was getting at is".
- If they ask what a word or phrase means: answer that briefly, then bridge back ("so going back to what I was saying") and resume the not-yet-spoken thread.
- If they go on a tangent: answer the tangent, then ask if they want to return to the earlier explanation or move on.
- If they signal they're done ("got it", "okay next", "move on"): acknowledge and pivot; you do not need to finish the not-yet-spoken part unless they ask.
- If they say you're too fast: slow down and re-explain the current chunk with shorter phrases and more breathing room before resuming.
- Otherwise: address their interruption first, then decide whether to resume the not-yet-spoken content with a natural transition ("so as I was saying…").

Keep the reply short and speakable (plain text, no markdown).`;
}

function buildVoiceLanguageInstruction(voiceLanguage?: string): string {
  const map: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    ko: "Korean",
    ja: "Japanese",
    zh: "Chinese",
  };
  const selected = voiceLanguage ? map[voiceLanguage] : undefined;
  if (selected) {
    return `LANGUAGE:\n- The voice language is set to ${selected}. Reply in ${selected} unless the student explicitly asks for another language.\n- If the course terms are in another language, preserve key technical terms when helpful, but explain naturally in ${selected}.\n- For voice flow, write complete short sentences with normal ${selected} punctuation. Do not leave sentence endings implied, and do not create run-on sentences.`;
  }
  return `LANGUAGE:\n- Auto mode: reply in the same language the student just used.\n- If the student mixes languages, mirror that naturally while keeping the explanation clear and professional.\n- Preserve important course terms in their original language when translating them would be confusing.\n- For voice flow, write complete short sentences with normal punctuation for that language. Do not leave sentence endings implied, and do not create run-on sentences.`;
}

function buildVoiceSystem(
  contextText: string,
  studyContext?: string,
  interruption?: VoiceContinuationHint,
  voiceLanguage?: string
): string {
  const selfStudySection = studyContext
    ? `\n${formatSelfStudyTutorBlock(studyContext)}\n`
    : "";
  const languageSection = buildVoiceLanguageInstruction(voiceLanguage);
  return `You are ${AI_ASSISTANT_NAME}, the student's voice tutor inside ${APP_NAME}. The student is TALKING TO YOU OUT LOUD and your reply will be SPOKEN BACK to them via text-to-speech. Write like a real person speaks — not like a written essay or chatbot.${selfStudySection}

${languageSection}

VOICE STYLE (very important):
- Let the FIRST sentence be the natural opener. Match the student's tone while staying professional and tutor-like: casual student -> warm/casual; stressed student -> calm/reassuring; direct student -> concise/direct; confused student -> slower and clearer.
- Do NOT rely on a fixed catchphrase. Avoid repeating the same lead-ins such as "Okay so," or "Yeah, so" every turn. Vary naturally based on the student's wording.
- If a brief backchannel fits, make it specific to the moment, e.g. "Got it, you're asking about the difference..." or "Yeah, that part is tricky because...". Skip backchannels when the answer can start directly.
- Sprinkle in natural spoken words sparingly: "like", "you know", "I mean", "basically", "kind of", "honestly". Don't overuse — 1 or 2 per reply, not every sentence.
- MIRROR the student's vocabulary, casualness, and energy, but clean it up just enough to stay credible and professional. If they say "ngl I'm kinda lost", be approachable without sounding like a parody.
- Use contractions ("you're", "we'll", "it's", "that's"). Use rhetorical asides like "right?", "make sense?" occasionally, only when it helps the spoken flow.
- Keep it SHORT. 1–3 spoken sentences is the norm. Only go longer if they explicitly ask for depth or it's truly a layered question. Most replies should be under 40 words.
- NO markdown. No asterisks, bullets, headers, code fences, or LaTeX — none of that survives TTS. Plain spoken English only.
- Don't read URLs, long lists, or symbol-heavy formulas aloud — paraphrase them.

RULES:
- Answer ONLY using the CONTEXT below. If something isn't in the student's notes, say it naturally — e.g. "Honestly, that's not really in your notes — closest thing is [X], wanna check that out?".
- Never invent facts, citations, numbers, or sources that aren't in CONTEXT.
- If CONTEXT says the student is on an active quiz screen, don't read out the correct MCQ letter or paste stored reference answers — but DO explain concepts and guide their thinking. Never refuse by calling them a cheater.
- Output ONLY the spoken reply as plain text. No JSON, no preamble, no labels, no quotes around it.

CONTEXT:
---
${contextText}
---${
    interruption &&
    (interruption.spokenBeforeInterrupt.trim() ||
      interruption.notYetSpoken.trim())
      ? voiceInterruptionAddendum(interruption)
      : ""
  }`;
}

export async function* streamVoiceReply(
  contextText: string,
  messages: StudyChatTurn[],
  studyContext?: string,
  interruption?: VoiceContinuationHint,
  voiceLanguage?: string
): AsyncGenerator<string, void, void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({ apiKey });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 500,
    system: buildVoiceSystem(
      contextText,
      studyContext,
      interruption,
      voiceLanguage
    ),
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

  try {
    const final = await stream.finalMessage();
    recordAiUsage({
      model: MODEL,
      inputTokens: final.usage?.input_tokens,
      outputTokens: final.usage?.output_tokens,
      feature: "voice-converse",
    });
  } catch {
    // Usage telemetry only — the reply already streamed to the caller.
  }
}

export async function runStudyChat(
  contextText: string,
  messages: StudyChatTurn[],
  studyContext?: string
): Promise<{ reply: string; action: unknown | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const selfStudySection = studyContext
    ? `\n${formatSelfStudyTutorBlock(studyContext)}\n`
    : "";

  const system = `You are ${AI_ASSISTANT_NAME}, an expert but friendly tutor. The student is working inside ${APP_NAME} on course material generated from their own uploaded files.${selfStudySection}

YOUR PRIMARY JOB IS TO ANSWER THE QUESTION:
- When the student asks something, actually answer it — explain, teach, give intuition, work through examples, and connect ideas. This is your main job, every turn.
- Prefer the student's own course material (the CONTEXT below: FULL COURSE MAP, lesson content, key terms) whenever it's relevant — ground your answer in it and reference it naturally.
- When the material doesn't cover the question (or only partly does), use your own general knowledge to give a complete, correct answer anyway. You are course-aware, NOT course-restricted. Don't refuse or deflect just because something isn't in their notes — answer it, and you can briefly note it goes beyond their uploaded material.
- Topics may live in a different module than the one on screen — check the course map before assuming something isn't covered.
- Be a real tutor: never refuse by calling the student a cheater. Studying for a quiz is normal.
- On the MODULE QUIZ screen only: do not reveal the correct multiple-choice letter or copy the stored reference answer verbatim. Still explain the underlying ideas and guide their reasoning.

Navigation (OPTIONAL — never the main act):
- Answering comes first. Only suggest navigating to a specific module/lesson when it is GENUINELY relevant — e.g. the student explicitly asks to be taken somewhere, or a particular module clearly has much deeper coverage of what they're studying. Do NOT default to navigation, and do NOT send them away instead of answering.
- When you suggest a location, set "action" so the UI can show a clickable button the student may tap. Never assume they will be moved automatically — phrase the reply as an invitation ("Want to explore Module X?") not as if you already took them there.
- Otherwise "action" must be null. Still put your full answer in "reply" even when you set an action.
- Never mention materialId UUIDs to the student.

Output format (CRITICAL):
- Return ONLY one JSON object. No markdown before or after. No duplicate JSON in the reply field.
- Shape: {"reply": string, "action": null | {"type":"navigate_to_location","materialId":string,"moduleId":number} | {"type":"navigate_by_query","query":string}}
- The "reply" field is REQUIRED and must contain your actual answer to the student as plain user-visible text (markdown is fine) — never JSON, never code fences, never empty. The "action" field is optional and defaults to null.
- Never use emoji, emoticons, or decorative symbols (no checkmarks, stars, sparkles, arrows-as-ornament, etc.). Keep the tone professional and clean — plain prose and markdown only.

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
  recordAiUsage({
    model: MODEL,
    inputTokens: msg.usage?.input_tokens,
    outputTokens: msg.usage?.output_tokens,
    feature: "study-chat",
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }

  const raw = block.text.trim();
  return parseStudyChatResponse(raw);
}
