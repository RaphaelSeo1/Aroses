import Anthropic from "@anthropic-ai/sdk";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/lib/brand";
import type { CoursePayload } from "@/types/course";
import { isQuizMcq } from "@/types/course";
import type { MCQuestion } from "@/types/study";
import type { StudyChatTurn } from "@/types/study-chat";

const MODEL = "claude-sonnet-4-20250514";

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

export async function runStudyChat(
  contextText: string,
  messages: StudyChatTurn[]
): Promise<string> {
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

  return block.text.trim();
}
