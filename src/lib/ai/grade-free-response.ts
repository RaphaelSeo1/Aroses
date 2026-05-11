import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

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

export async function gradeFreeResponseWithAi(opts: {
  question: string;
  referenceAnswer: string;
  studentAnswer: string;
}): Promise<{ correct: boolean; feedback: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({ apiKey });

  const userPrompt = `You are grading a student's short answer for an undergraduate-style quiz.

QUESTION:
${opts.question.trim()}

REFERENCE (what a solid answer should demonstrate — do not expect verbatim copying):
${opts.referenceAnswer.trim()}

STUDENT ANSWER:
${opts.studentAnswer.trim()}

Return ONLY valid JSON with this exact shape (no markdown fences):
{"correct": true or false, "feedback": "one short paragraph: if wrong, what was missing or mistaken; if correct, brief affirmation"}

Rules:
- correct=true only if the student demonstrates substantially correct understanding (partial credit does NOT count as correct).
- correct=false if the answer is vague, wrong, or misses critical concepts.
- Be concise in feedback; encouraging tone.`;

  let lastErr: unknown;
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = msg.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        throw new Error("Unexpected response from model");
      }
      let text = block.text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      }
      const parsed = JSON.parse(text) as {
        correct?: unknown;
        feedback?: unknown;
      };
      const correct = parsed.correct === true;
      const feedback =
        typeof parsed.feedback === "string" && parsed.feedback.trim().length > 0
          ? parsed.feedback.trim()
          : correct
            ? "Nice work — that captures the main ideas."
            : "Not quite — compare your reasoning to the lesson and try again.";
      return { correct, feedback };
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
