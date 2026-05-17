import Anthropic from "@anthropic-ai/sdk";
import {
  normalizeQuizItemsLoose,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import { isQuizMcq } from "@/types/course";
import type {
  CourseQuizMcqItem,
  CourseModule,
  CoursePayload,
} from "@/types/course";
import type {
  GoalsAnswer,
  KnowledgeLevel,
  MentoredIntent,
  MentoredLessonChunk,
  MentoredLessonPlan,
} from "@/types/mentored";

const MODEL = "claude-sonnet-4-6";
const FAST_MODEL = "claude-haiku-4-5";
const MAX_CONTEXT_CHARS = 12_000;

// ---------------------------------------------------------------------------
// 1. Onboarding level quiz — 3-5 MCQs gauging prior knowledge
// ---------------------------------------------------------------------------

export type OnboardingQuizInput = {
  course: CoursePayload;
  /** How many questions to ask. Clamped to 3..5. */
  count?: number;
};

export async function generateOnboardingQuiz(
  input: OnboardingQuizInput
): Promise<CourseQuizMcqItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const target = Math.max(3, Math.min(5, Math.floor(input.count ?? 4)));
  const ask = target + 2;

  const outline = input.course.modules
    .slice(0, 10)
    .map((m) => `Module ${m.id}: ${m.title}`)
    .join("\n");
  const sampleConcepts = input.course.modules
    .slice(0, 6)
    .flatMap((m) =>
      m.lessons.slice(0, 2).map((l) => `- (${m.title}) ${l.title}`)
    )
    .slice(0, 16)
    .join("\n");

  const prompt = `You are designing a short PRE-COURSE assessment that gauges how much a learner already knows about this subject. The questions test foundational background, not the deep specifics of this particular course's content — the goal is to figure out where this learner is starting from.

COURSE TITLE: ${input.course.title.slice(0, 200)}
COURSE DESCRIPTION: ${input.course.description.slice(0, 400)}

COURSE OUTLINE:
${outline}

REPRESENTATIVE TOPICS COVERED:
${sampleConcepts}

Output EXACTLY ${ask} multiple-choice questions as a JSON array only (no markdown fences, no commentary).
Each object: { "type": "mcq", "question": string, "choices": [4 strings], "correct": "A"|"B"|"C"|"D" OR matching choice text, "explanation": string }

Strict rules:
1) FOUNDATIONAL: Test entry-level knowledge a beginner should have on this subject area. Avoid trick questions or jargon a complete novice could not parse.
2) RANGE OF DIFFICULTY: Mix 1-2 very easy (beginner check), 1-2 intermediate, 1 harder so the score actually discriminates.
3) NON-COURSE-SPECIFIC: Do NOT ask about exact phrasing or examples from THIS course's outline — these are background-knowledge questions, not course-content questions.
4) PLAUSIBLE DISTRACTORS: Wrong choices should be plausible to someone without the background, not obviously absurd.
5) ONE FACT PER QUESTION: Don't combine multiple concepts into one stem.`;

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 0.4,
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
  if (!Array.isArray(parsed)) throw new Error("Expected JSON array");

  const normalized = normalizeQuizItemsLoose(parsed);
  return normalized.filter(isQuizMcq).slice(0, target);
}

// ---------------------------------------------------------------------------
// 2. Chunked lesson plan — break a module into teach→check units
// ---------------------------------------------------------------------------

export type LessonPlanInput = {
  module: CourseModule;
  goals: GoalsAnswer[];
  knowledgeLevel: KnowledgeLevel;
};

// Bump when the prompt or parser changes in a way that invalidates cached
// plans. v2 adds `keyTerms` so the immersive runner can glow phrases in the
// source-lesson panel.
const LESSON_PLAN_VERSION = 2;

function levelGuidance(level: KnowledgeLevel): string {
  switch (level) {
    case "beginner":
      return "BEGINNER: Use simple language, ground everything in concrete analogies, build from first principles. Avoid jargon. Define every technical term inline the first time it appears.";
    case "intermediate":
      return "INTERMEDIATE: Assume basic foundations are in place. Focus on connecting ideas, contrasts, and nuance. Use technical vocabulary but explain anything advanced.";
    case "advanced":
      return "ADVANCED: Skip the basics, dive into mechanism / edge cases / why it works the way it does. Use technical vocabulary freely.";
  }
}

function shortIdFor(seed: string, idx: number): string {
  const cleaned = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return `${cleaned || "chunk"}-${idx}`;
}

export async function generateLessonPlan(
  input: LessonPlanInput
): Promise<MentoredLessonPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const lessons = input.module.lessons
    .map(
      (l, i) =>
        `=== Lesson ${i + 1}: ${l.title} ===\n${(l.content ?? "").slice(0, 4000)}`
    )
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  const goalsText =
    input.goals.length > 0
      ? input.goals
          .map((g) => `Q: ${g.question}\nA: ${g.answer}`)
          .join("\n\n")
      : "(none provided)";

  const prompt = `You are a one-on-one tutor planning how to TEACH a specific module to a student.

MODULE: ${input.module.title}

STUDENT BACKGROUND:
${goalsText}

CALIBRATION:
${levelGuidance(input.knowledgeLevel)}

SOURCE LESSON CONTENT (use as ground truth — do not invent facts):
${lessons}

Break this module into SMALL teaching chunks. Each chunk = ONE atomic concept the student should walk away understanding, plus ONE check question to verify it landed.

Output a JSON array only (no markdown fences). Each object:
{
  "concept": "1-line concept name (becomes the on-screen heading)",
  "explanation": "3-6 sentences a tutor would say out loud to teach this single idea. Plain prose. No markdown, no lists.",
  "analogy": "optional — one short analogy the tutor can fall back on if the student misses the question",
  "checkQuestion": "ONE question that tests this exact concept (not the next one, not the previous one)",
  "referenceAnswer": "what a strong answer should say (used internally to grade; 1-3 sentences)",
  "keyPoints": ["3-5 short bullet phrases the student's answer should hit"],
  "sourceLessonIndex": 0-based index of the lesson this chunk corresponds to (integer),
  "keyTerms": ["2-5 short phrases (1-4 words each) that appear VERBATIM in the SOURCE LESSON CONTENT above. These are the exact words the student should see glow in their source material while this chunk is being taught. Match the surface form exactly, including capitalization."]
}

Strict rules:
1) GRANULARITY: 5-10 chunks per module typical. Too few = too dense; too many = busywork.
2) ORDER: Chunks must teach in pedagogical order — prerequisites before what depends on them.
3) NO REPETITION: Don't re-ask the same fact across chunks.
4) CHECK = MEANINGFUL: Each checkQuestion must be answerable with 1-3 sentences of explanation, not a trivia recall.
5) SPOKEN PROSE: Write explanation and analogy as if speaking — no bullet points, no headers, no markdown.
6) KEY TERMS APPEAR IN SOURCE: Every keyTerm MUST be a substring of the lesson the chunk maps to. Do not invent terms. If a chunk is hard to anchor (e.g. pure overview), it's fine to return fewer keyTerms or an empty array.`;

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6000,
    temperature: 0.45,
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
  if (!Array.isArray(parsed)) throw new Error("Expected JSON array");

  const chunks: MentoredLessonChunk[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Record<string, unknown>;
    const concept = typeof raw.concept === "string" ? raw.concept.trim() : "";
    const explanation =
      typeof raw.explanation === "string" ? raw.explanation.trim() : "";
    const checkQuestion =
      typeof raw.checkQuestion === "string" ? raw.checkQuestion.trim() : "";
    const referenceAnswer =
      typeof raw.referenceAnswer === "string"
        ? raw.referenceAnswer.trim()
        : "";
    if (!concept || !explanation || !checkQuestion || !referenceAnswer) {
      continue;
    }
    const keyPoints = Array.isArray(raw.keyPoints)
      ? (raw.keyPoints as unknown[])
          .map((kp) => (typeof kp === "string" ? kp.trim() : ""))
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const analogy =
      typeof raw.analogy === "string" && raw.analogy.trim().length > 0
        ? raw.analogy.trim()
        : undefined;
    const sourceIndex =
      typeof raw.sourceLessonIndex === "number" &&
      Number.isFinite(raw.sourceLessonIndex)
        ? Math.max(0, Math.min(input.module.lessons.length - 1, raw.sourceLessonIndex))
        : undefined;

    // Filter keyTerms down to phrases that actually appear in the source
    // lesson content (case-insensitive). If the AI hallucinated terms that
    // don't exist verbatim, drop them — they'd just fail to highlight.
    const sourceText =
      typeof sourceIndex === "number"
        ? (input.module.lessons[sourceIndex]?.content ?? "")
        : input.module.lessons.map((l) => l.content ?? "").join(" ");
    const sourceLower = sourceText.toLowerCase();
    const keyTermsRaw = Array.isArray(raw.keyTerms)
      ? (raw.keyTerms as unknown[])
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter((t) => t.length >= 2 && t.length <= 60)
      : [];
    const keyTerms = keyTermsRaw
      .filter((t) => sourceLower.includes(t.toLowerCase()))
      .slice(0, 5);

    chunks.push({
      id: shortIdFor(concept, i),
      concept,
      explanation,
      checkQuestion,
      referenceAnswer,
      keyPoints,
      analogy,
      sourceLessonIndex: sourceIndex,
      keyTerms: keyTerms.length > 0 ? keyTerms : undefined,
    });
  }

  if (chunks.length === 0) {
    throw new Error("Lesson plan was empty");
  }

  return {
    moduleId: input.module.id,
    generatorVersion: LESSON_PLAN_VERSION,
    chunks,
  };
}

// ---------------------------------------------------------------------------
// 3. Per-utterance turn classifier + response generator
// ---------------------------------------------------------------------------

export type TurnInput = {
  chunk: MentoredLessonChunk;
  attempts: number;
  studentUtterance: string;
  knowledgeLevel: KnowledgeLevel;
};

export type TurnOutput = {
  intent: MentoredIntent;
  reply: string;
  advance: boolean;
  addToFocusedReview: boolean;
};

const INTENT_VALUES: MentoredIntent[] = [
  "answer_correct",
  "answer_partial",
  "answer_wrong",
  "pace_slower",
  "pace_faster",
  "skip_concept",
  "move_on",
  "tangent_question",
  "request_repeat",
  "request_pause",
  "request_clarify",
  "other",
];

function isIntent(v: unknown): v is MentoredIntent {
  return typeof v === "string" && (INTENT_VALUES as string[]).includes(v);
}

export async function runMentoredTurn(input: TurnInput): Promise<TurnOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const prompt = `You are an AI tutor mid-lesson. The student is on this CHUNK:

CONCEPT: ${input.chunk.concept}
EXPLANATION YOU JUST GAVE: ${input.chunk.explanation}
ANALOGY (optional fallback): ${input.chunk.analogy ?? "(none)"}
CHECK QUESTION YOU JUST ASKED: ${input.chunk.checkQuestion}
REFERENCE ANSWER (internal — never read this aloud verbatim): ${input.chunk.referenceAnswer}
KEY POINTS THE ANSWER SHOULD HIT: ${input.chunk.keyPoints.join("; ")}
ATTEMPT NUMBER FOR THIS CHUNK: ${input.attempts + 1}
STUDENT LEVEL: ${input.knowledgeLevel}

STUDENT JUST SAID: """
${input.studentUtterance.trim().slice(0, 2000)}
"""

Classify what the student just said and craft your spoken reply.

Output STRICT JSON only, no markdown fences:
{
  "intent": one of [answer_correct, answer_partial, answer_wrong, pace_slower, pace_faster, skip_concept, move_on, tangent_question, request_repeat, request_pause, request_clarify, other],
  "reply": "the natural-language reply you should speak out loud (1-4 sentences). Conversational. No markdown. No 'as an AI'.",
  "advance": true|false  — true ONLY if you're confident this chunk is now complete and you can move to the next one,
  "addToFocusedReview": true|false  — true if this concept should silently be added to the student's Focused Review queue (use this when intent is answer_wrong on attempt >= 2, or repeated answer_partial)
}

Guidelines:
- answer_correct → praise briefly and signal "advance": true.
- answer_partial → name what they got right, fill the gap, then re-ask or invite refinement. "advance": false.
- answer_wrong on attempt 1 → re-explain from a different angle (use the analogy if you have one). "advance": false, "addToFocusedReview": false.
- answer_wrong on attempt 2 → try one more angle. "advance": false, "addToFocusedReview": true.
- answer_wrong on attempt 3+ → acknowledge they're stuck, OFFER a choice ("keep going and come back, or try once more"). "advance": false, "addToFocusedReview": true.
- pace_slower / pace_faster → acknowledge naturally ("sure, let me slow down a bit"), no advance.
- skip_concept / move_on → acknowledge and "advance": true.
- tangent_question → answer briefly (1-2 sentences), then steer back to the current concept. "advance": false.
- request_repeat → restate the explanation in fresh words. "advance": false.
- request_clarify → clarify ONE step. "advance": false.
- request_pause → acknowledge and offer to resume. "advance": false.
- other → infer best interpretation; default "advance": false.

Tone: real human tutor. Conversational. Never lecture-y.`;

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 700,
    temperature: 0.5,
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
  const raw = parsed as Record<string, unknown>;
  const intent: MentoredIntent = isIntent(raw.intent) ? raw.intent : "other";
  const reply =
    typeof raw.reply === "string" && raw.reply.trim().length > 0
      ? raw.reply.trim()
      : "Let's keep going.";
  const advance =
    raw.advance === true ||
    intent === "answer_correct" ||
    intent === "skip_concept" ||
    intent === "move_on";
  const addToFocusedReview = raw.addToFocusedReview === true;

  return { intent, reply, advance, addToFocusedReview };
}

// ---------------------------------------------------------------------------
// 4. Knowledge-level inference from the onboarding quiz score
// ---------------------------------------------------------------------------

export function inferKnowledgeLevel(scorePct: number): KnowledgeLevel {
  if (scorePct >= 80) return "advanced";
  if (scorePct >= 50) return "intermediate";
  return "beginner";
}
