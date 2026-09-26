import Anthropic from "@anthropic-ai/sdk";
import {
  normalizeQuizItemsLoose,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import {
  DEFAULT_COURSE_OUTPUT_LANGUAGE,
  formatOutputLanguageGenerationBlock,
  type CourseOutputLanguage,
} from "@/lib/course-output-language";
import type { CourseModule, CourseQuizItem } from "@/types/course";

const MODEL = "claude-sonnet-4-6";

const MAX_LESSON_CHARS = 28_000;

function lessonCorpus(m: CourseModule): string {
  const parts = m.lessons.map(
    (l) => `## ${l.title}\n${l.content}`
  );
  const joined = parts.join("\n\n");
  if (joined.length <= MAX_LESSON_CHARS) return joined;
  const head = Math.floor(MAX_LESSON_CHARS * 0.65);
  const tail = MAX_LESSON_CHARS - head - 40;
  return `${joined.slice(0, head)}\n\n[ … omitted … ]\n\n${joined.slice(-tail)}`;
}

/**
 * Ask the model for additional quiz items grounded in this module’s lessons.
 */
export async function generateAdditionalModuleQuizItems(
  module: CourseModule,
  count: number,
  outputLanguage: CourseOutputLanguage = DEFAULT_COURSE_OUTPUT_LANGUAGE
): Promise<CourseQuizItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const n = Math.min(16, Math.max(4, Math.floor(count)));
  const stems = module.quiz.map((q) => q.question.trim()).filter(Boolean);
  const stemHint =
    stems.length > 0
      ? stems.slice(0, 24).map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none yet)";

  const prompt = `You are writing practice quiz questions for ONE module of a study course.

MODULE TITLE: ${module.title}

LESSON CONTENT (source of truth — stay strictly on these topics):
${lessonCorpus(module)}

EXISTING QUESTION STEMS (do NOT repeat or trivially rephrase these):
${stemHint}

Task: Output EXACTLY ${n} NEW practice questions as a JSON array only (no markdown fences, no commentary).
${formatOutputLanguageGenerationBlock(outputLanguage)}
Mix multiple-choice and short written answer:
- MCQ objects: { "type": "mcq", "question": string, "choices": [4 strings], "correct": "A"|"B"|"C"|"D" OR matching choice text, "explanation": string }
- Free-response: { "type": "free_response", "question": string, "reference_answer": string (snake_case, detailed rubric), "explanation": string }

Aim for roughly half MCQ and half free_response. Questions must test understanding of the lesson content above.`;

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0 });

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    temperature: 0.35,
    messages: [{ role: "user", content: prompt }],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(block.text));
  } catch {
    throw new Error("Claude did not return valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of quiz items");
  }

  const items = normalizeQuizItemsLoose(parsed);
  if (items.length === 0) {
    throw new Error("No valid quiz items could be parsed from the model output");
  }

  return items;
}
