import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";
export type FreeResponseVerdict =
  | "correct"
  | "mostly_correct"
  | "needs_work";

export type FreeResponseGrade = {
  /** "mostly_correct" counts as understood for quiz progress. */
  correct: boolean;
  verdict: FreeResponseVerdict;
  feedback: string;
};

export const FREE_RESPONSE_GRADING_SYSTEM = `You are a fair, concept-focused grader for undergraduate short-answer questions.

Evaluate whether the student understands the concept, not whether they copied the reference wording. Treat the reference as a rubric and source of truth, not a model answer that must be reproduced.

GRADING STANDARD:
- correct: The central claim, mechanism, or reasoning is accurate. Accept concise answers, synonyms, paraphrases, different organization, and omission of nonessential details.
- mostly_correct: The student clearly understands the central concept but has one meaningful omission, ambiguity, or minor imprecision. Do not fail an answer for this.
- needs_work: The answer misses or contradicts a core idea, shows a material misconception, is too vague to establish understanding, or does not answer the question.
- Do not require every detail in the reference unless the question explicitly asks for a list, multiple parts, steps, or specific examples.
- Do not penalize grammar, spelling, style, or terminology when the intended concept is clear.
- Judge only against the question and reference. Do not introduce outside requirements.

FEEDBACK:
- Write one or two brief, specific sentences.
- Address the learner directly as "you," not as "the student."
- Say what the answer demonstrates correctly.
- For mostly_correct or needs_work, identify the single most important missing or mistaken idea and briefly state the correction.
- Never give generic feedback such as only "needs work," "not quite," or "compare with the lesson."

Return ONLY valid JSON:
{"verdict":"correct"|"mostly_correct"|"needs_work","feedback":"specific brief explanation"}`;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRetryableApiError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIConnectionError) return true;
  if (err instanceof APIError && typeof err.status === "number") {
    const s = err.status;
    return [408, 429, 500, 502, 503, 529].includes(s);
  }
  return false;
}

export function buildFreeResponseGradingPrompt(opts: {
  question: string;
  referenceAnswer: string;
  studentAnswer: string;
}): string {
  return `QUESTION:
${opts.question.trim()}

REFERENCE RUBRIC:
${opts.referenceAnswer.trim()}

STUDENT ANSWER:
${opts.studentAnswer.trim()}`;
}

export function parseFreeResponseGrade(raw: string): FreeResponseGrade {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  const parsed = JSON.parse(text) as {
    verdict?: unknown;
    correct?: unknown;
    feedback?: unknown;
  };
  const verdict: FreeResponseVerdict =
    parsed.verdict === "correct" ||
    parsed.verdict === "mostly_correct" ||
    parsed.verdict === "needs_work"
      ? parsed.verdict
      : parsed.correct === true
        ? "correct"
        : "needs_work";
  const feedback =
    typeof parsed.feedback === "string" && parsed.feedback.trim().length > 0
      ? parsed.feedback.trim()
      : verdict === "correct"
        ? "Your answer captures the central concept accurately."
        : verdict === "mostly_correct"
          ? "Your answer shows the main idea, but one important detail needs clarification."
          : "Your answer does not yet establish the central concept.";
  return {
    correct: verdict !== "needs_work",
    verdict,
    feedback: feedback.slice(0, 1_000),
  };
}

export async function gradeFreeResponseWithAi(opts: {
  question: string;
  referenceAnswer: string;
  studentAnswer: string;
}): Promise<FreeResponseGrade> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({ apiKey });
  const userPrompt = buildFreeResponseGradingPrompt(opts);

  let lastErr: unknown;
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        temperature: 0.1,
        system: FREE_RESPONSE_GRADING_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = msg.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("Unexpected response from model");
      }
      return parseFreeResponseGrade(block.text);
    } catch (err) {
      lastErr = err;
      const retryParse = err instanceof SyntaxError && attempt < maxAttempts - 1;
      const retryNet =
        isRetryableApiError(err) && attempt < maxAttempts - 1;
      if (!retryParse && !retryNet) throw err;
      await sleep(Math.min(30_000, 900 * 2 ** attempt));
    }
  }
  throw lastErr;
}
