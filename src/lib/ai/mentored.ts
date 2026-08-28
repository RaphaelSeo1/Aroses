import Anthropic from "@anthropic-ai/sdk";
import { tutorChatModel } from "@/lib/ai/anthropic-models";
import {
  formatMentoredTeachingLanguageBlock,
  type CourseOutputLanguage,
} from "@/lib/course-output-language";
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
import { TURN_WB_SENTINEL } from "@/lib/mentored/whiteboard-utils";
import type {
  GoalsAnswer,
  KnowledgeLevel,
  MentoredIntent,
  MentoredLessonChunk,
  MentoredLessonPlan,
  MentoredPersonalization,
  WhiteboardAction,
  WhiteboardActionColor,
  WhiteboardPoint,
} from "@/types/mentored";

const MODEL = "claude-sonnet-4-6";
const FAST_MODEL = tutorChatModel();
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
  /** Self-study course goal — used when onboarding goals are empty. */
  studyContext?: string;
  /** Course output / teaching language from upload settings. */
  outputLanguage?: CourseOutputLanguage;
};

// Bump when the prompt or parser changes in a way that invalidates cached
// plans. v2 adds `keyTerms` so the immersive runner can glow phrases in the
// source-lesson panel.
export const LESSON_PLAN_GENERATOR_VERSION = 5;
const LESSON_PLAN_VERSION = LESSON_PLAN_GENERATOR_VERSION;

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

const LESSON_PLAN_TOOL = {
  name: "submit_lesson_plan",
  description:
    "Submit the module teaching plan as structured chunks for Mentored Learning.",
  input_schema: {
    type: "object" as const,
    properties: {
      chunks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: { type: "string" },
            explanation: { type: "string" },
            analogy: { type: "string" },
            checkQuestion: { type: "string" },
            referenceAnswer: { type: "string" },
            keyPoints: { type: "array", items: { type: "string" } },
            sourceLessonIndex: { type: "integer" },
            keyTerms: { type: "array", items: { type: "string" } },
            whiteboardActions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["draw_arrow", "add_label"],
                  },
                  from: {
                    type: "object",
                    properties: { x: { type: "number" }, y: { type: "number" } },
                  },
                  to: {
                    type: "object",
                    properties: { x: { type: "number" }, y: { type: "number" } },
                  },
                  text: { type: "string" },
                  position: {
                    type: "object",
                    properties: { x: { type: "number" }, y: { type: "number" } },
                  },
                },
              },
            },
          },
          required: [
            "concept",
            "explanation",
            "checkQuestion",
            "referenceAnswer",
            "keyPoints",
            "sourceLessonIndex",
          ],
        },
      },
    },
    required: ["chunks"],
  },
};

function parseLessonPlanJson(raw: string): unknown {
  const cleaned = stripJsonFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("invalid json");
  }
}

function extractLessonPlanArray(msg: Anthropic.Message): unknown {
  const toolUse = msg.content.find(
    (b) => b.type === "tool_use" && b.name === LESSON_PLAN_TOOL.name
  );
  if (toolUse?.type === "tool_use") {
    const input = toolUse.input as { chunks?: unknown };
    if (Array.isArray(input.chunks)) return input.chunks;
  }
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }
  return parseLessonPlanJson(block.text);
}

function buildLessonChunksFromArray(
  input: LessonPlanInput,
  parsed: unknown
): MentoredLessonChunk[] {
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
        ? Math.max(
            0,
            Math.min(input.module.lessons.length - 1, raw.sourceLessonIndex)
          )
        : undefined;

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

    const whiteboardActions = parseWhiteboardActions(raw.whiteboardActions);

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
      whiteboardActions:
        whiteboardActions.length > 0 ? whiteboardActions : undefined,
    });
  }

  return chunks;
}

function shortIdFor(seed: string, idx: number): string {
  const cleaned = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return `${cleaned || "chunk"}-${idx}`;
}

function parseWhiteboardPoint(v: unknown): WhiteboardPoint | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number") return null;
  return {
    x: Math.max(0, Math.min(100, o.x)),
    y: Math.max(0, Math.min(100, o.y)),
  };
}

function parseWhiteboardColor(v: unknown): WhiteboardActionColor | undefined {
  if (
    v === "excitatory" ||
    v === "inhibitory" ||
    v === "highlight" ||
    v === "default"
  ) {
    return v;
  }
  return undefined;
}

function parseWhiteboardCue(o: Record<string, unknown>): string | undefined {
  return typeof o.cue === "string" && o.cue.trim().length > 0
    ? o.cue.trim().slice(0, 60)
    : undefined;
}

function parseBbox(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map((n) => (typeof n === "number" ? n : NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [
    Math.max(0, Math.min(100, nums[0]!)),
    Math.max(0, Math.min(100, nums[1]!)),
    Math.max(0, Math.min(100, nums[2]!)),
    Math.max(0, Math.min(100, nums[3]!)),
  ];
}

export function parseWhiteboardActions(raw: unknown): WhiteboardAction[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: WhiteboardAction[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type;
    const cue = parseWhiteboardCue(o);
    const color = parseWhiteboardColor(o.color);
    if (type === "clear") {
      out.push({ type: "clear" });
      continue;
    }
    if (type === "clear_except" && Array.isArray(o.keepIds)) {
      const keepIds = (o.keepIds as unknown[])
        .filter((id): id is string => typeof id === "string")
        .slice(0, 12);
      if (keepIds.length > 0) out.push({ type: "clear_except", keepIds });
      continue;
    }
    if (type === "show_table") {
      out.push({ type: "show_table", ...(cue ? { cue } : {}) });
      continue;
    }
    if (type === "show_asset" && typeof o.assetId === "string") {
      const assetId = o.assetId.trim().slice(0, 80);
      if (assetId) out.push({ type: "show_asset", assetId, ...(cue ? { cue } : {}) });
      continue;
    }
    if (type === "highlight_bbox") {
      const bbox = parseBbox(o.bbox);
      if (bbox) {
        out.push({
          type: "highlight_bbox",
          ...(typeof o.assetId === "string" ? { assetId: o.assetId } : {}),
          bbox,
          ...(cue ? { cue } : {}),
          ...(color ? { color } : {}),
        });
      }
      continue;
    }
    if (type === "draw_arrow") {
      const from = parseWhiteboardPoint(o.from);
      const to = parseWhiteboardPoint(o.to);
      if (from && to) {
        out.push({
          type: "draw_arrow",
          from,
          to,
          ...(cue ? { cue } : {}),
          ...(color ? { color } : {}),
        });
      }
      continue;
    }
    if (type === "add_label" && typeof o.text === "string") {
      const text = o.text.trim().slice(0, 80);
      const position = parseWhiteboardPoint(o.position);
      if (text && position) {
        out.push({
          type: "add_label",
          text,
          position,
          ...(cue ? { cue } : {}),
          ...(color ? { color } : {}),
        });
      }
    }
  }
  return out.slice(0, 16);
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

  const goalsFromOnboarding =
    input.goals.length > 0
      ? input.goals.map((g) => `Q: ${g.question}\nA: ${g.answer}`).join("\n\n")
      : "";

  const goalsText =
    goalsFromOnboarding ||
    (input.studyContext?.trim()
      ? `SELF-STUDY GOAL:\n${input.studyContext.trim().slice(0, 2_000)}`
      : "(none provided)");

  const prompt = `You are a one-on-one tutor planning how to TEACH a specific module to a student.

${formatMentoredTeachingLanguageBlock(input.outputLanguage ?? "auto")}

MODULE: ${input.module.title}

STUDENT BACKGROUND:
${goalsText}

CALIBRATION:
${levelGuidance(input.knowledgeLevel)}
${
  input.studyContext?.trim()
    ? `
SELF-STUDY CALIBRATION: The student stated a personal goal above. Plan MORE chunks on their focus areas and FEWER on topics they say they already know. Match check questions to what they are trying to master.`
    : ""
}

SOURCE LESSON CONTENT (use as ground truth — do not invent facts):
${lessons}

Break this module into SMALL teaching chunks. Each chunk = ONE atomic concept the student should walk away understanding, plus ONE check question to verify it landed.

Call the submit_lesson_plan tool with a "chunks" array. Each chunk object:
- concept: 1-line concept name (on-screen heading)
- explanation: 3-6 sentences a tutor would say out loud. Plain prose, no markdown.
- analogy (optional): one short fallback analogy if the student misses the question
- checkQuestion: ONE question testing this exact concept
- referenceAnswer: what a strong answer should say (1-3 sentences, internal grading only)
- keyPoints: 3-5 short phrases the student's answer should hit
- sourceLessonIndex: 0-based lesson index this chunk maps to
- keyTerms (optional): 2-5 phrases that appear VERBATIM in the source lesson
- whiteboardActions (optional): planned live-whiteboard sequence. Types: show_table (anchor source table first), highlight_bbox, draw_arrow, add_label. Coords 0–100. Each action may include a short "cue" phrase Rose says when drawing it (for progressive reveal sync).

Strict rules:
1) GRANULARITY: 5-10 chunks per module typical. Too few = too dense; too many = busywork.
2) ORDER: Chunks must teach in pedagogical order — prerequisites before what depends on them.
3) NO REPETITION: Don't re-ask the same fact across chunks.
4) CHECK = MEANINGFUL: Each checkQuestion must be answerable with 1-3 sentences of explanation, not a trivia recall.
5) SPOKEN PROSE: Write explanation and analogy as if speaking — no bullet points, no headers, no markdown.
6) DEPTH: Explanations must teach mechanisms and reasoning (why/how), not just name a concept. Include at least one concrete detail from the source (pathway, drug, number, comparison). Avoid generic openers — start with substance.
7) KEY TERMS APPEAR IN SOURCE: Every keyTerm MUST be a substring of the lesson the chunk maps to. Do not invent terms. If a chunk is hard to anchor (e.g. pure overview), it's fine to return fewer keyTerms or an empty array.`;

  const anthropic = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 0 });

  async function callPlan(
    userPrompt: string,
    maxTokens: number
  ): Promise<Anthropic.Message> {
    return anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.45,
      tools: [LESSON_PLAN_TOOL],
      tool_choice: { type: "tool", name: LESSON_PLAN_TOOL.name },
      messages: [{ role: "user", content: userPrompt }],
    });
  }

  function logPlanFailure(phase: string, msg: Anthropic.Message, err: unknown) {
    const toolUse = msg.content.find((b) => b.type === "tool_use");
    console.error("[mentored generateLessonPlan]", phase, {
      stopReason: msg.stop_reason,
      contentTypes: msg.content.map((b) => b.type),
      toolName: toolUse?.type === "tool_use" ? toolUse.name : null,
      err,
    });
  }

  let chunks: MentoredLessonChunk[];
  const msg = await callPlan(prompt, 16_000);
  try {
    chunks = buildLessonChunksFromArray(input, extractLessonPlanArray(msg));
  } catch (e) {
    logPlanFailure("initial", msg, e);
    const textBlock = msg.content.find((b) => b.type === "text");
    const broken =
      textBlock?.type === "text"
        ? textBlock.text
        : JSON.stringify(
            msg.content.find((b) => b.type === "tool_use") ?? msg.content
          );
    const repairMsg = await callPlan(
      `${prompt}

---
Your previous lesson-plan response could not be parsed. Call submit_lesson_plan again with 5–8 valid chunks. Every chunk needs non-empty concept, explanation, checkQuestion, referenceAnswer, and keyPoints (string array).

Broken output:
${broken.slice(0, 40_000)}`,
      16_000
    );
    try {
      chunks = buildLessonChunksFromArray(
        input,
        extractLessonPlanArray(repairMsg)
      );
    } catch (e2) {
      logPlanFailure("repair", repairMsg, e2);
      const compactPrompt = `${prompt}

---
IMPORTANT: Produce exactly **5 or 6** chunks (not more) so the plan fits. Shorter explanations (2-4 sentences each). Call submit_lesson_plan now.`;
      const compactMsg = await callPlan(compactPrompt, 12_000);
      try {
        chunks = buildLessonChunksFromArray(
          input,
          extractLessonPlanArray(compactMsg)
        );
      } catch (e3) {
        logPlanFailure("compact", compactMsg, e3);
        throw new Error("Claude did not return valid JSON");
      }
    }
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
  /**
   * The text Rose had already spoken (and the student heard) when the
   * student barged in. Drives the "acknowledge interruption + offer to
   * resume" branch in the prompt. Omit / empty string when there was
   * no interruption.
   */
  interruptedAfter?: string;
  /**
   * Seconds since the last check question Rose asked in this session.
   * Used for smart pacing — Rose holds off on a new check if < 30s,
   * starts gently considering one after 90s of monologue. `null`
   * means no prior check in this session.
   */
  secondsSinceLastCheck?: number | null;
  /**
   * Seconds since the student last spoke. Long silences are a trigger
   * for a gentle check-in. `null` means no prior utterance yet.
   */
  secondsSinceStudentSpoke?: number | null;
  /**
   * AI-extracted personalization from the student's onboarding answers.
   * Drives "skip basics they already know" / "lean into focus areas"
   * branches of the turn prompt. Omit / empty object when not yet
   * extracted — the prompt falls back to the bare `knowledgeLevel`.
   */
  personalization?: MentoredPersonalization;
  /** Course output / teaching language from upload settings. */
  outputLanguage?: CourseOutputLanguage;
  /**
   * False when Rose has not yet spoken this chunk's explanation (session
   * still in greeting / ready-to-start). Affirmative replies must not be
   * graded as check-question answers.
   */
  chunkTeachingStarted?: boolean;
};

export type TurnOutput = {
  intent: MentoredIntent;
  reply: string;
  advance: boolean;
  addToFocusedReview: boolean;
  /** Live whiteboard overlay actions from the tutor turn. */
  whiteboardActions: WhiteboardAction[];
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
  "check_in",
  "other",
];

function isIntent(v: unknown): v is MentoredIntent {
  return typeof v === "string" && (INTENT_VALUES as string[]).includes(v);
}

// Sentinel separating spoken reply text from trailing metadata JSON in
// the streaming prompt format. Anything before the sentinel is read
// aloud / displayed; anything after gets parsed as classification.
const TURN_META_SENTINEL = "---META---";

function buildTurnPrompt(input: TurnInput): string {
  // Personalization block — woven in BEFORE the chunk context so Rose
  // reads it as the lens through which she should approach this turn.
  // Empty / missing → block is skipped entirely (no noise in prompt).
  const p = input.personalization;
  const hasP =
    p &&
    (p.summary ||
      (p.knownTopics?.length ?? 0) > 0 ||
      (p.focusAreas?.length ?? 0) > 0 ||
      p.experienceLevel);
  const personalizationBlock = hasP
    ? `

STUDENT PROFILE (read this every turn — it shapes vocabulary, depth, and pacing):
${p?.summary ? `- Summary: ${p.summary}` : ""}
${p?.experienceLevel ? `- Experience level: ${p.experienceLevel}` : ""}
${
  p?.knownTopics && p.knownTopics.length > 0
    ? `- Topics they say they already know (FAST-FORWARD with a quick recap; don't re-explain from zero): ${p.knownTopics.join(", ")}`
    : ""
}
${
  p?.focusAreas && p.focusAreas.length > 0
    ? `- Topics they want EXTRA depth on (slow down, give more examples, deeper questions): ${p.focusAreas.join(", ")}`
    : ""
}`.replace(/\n\n+/g, "\n").trim()
    : "";

  const interruptedBlock =
    input.interruptedAfter && input.interruptedAfter.trim().length > 0
      ? `

INTERRUPTION CONTEXT: The student cut you off MID-SENTENCE. Below is exactly what you had already said out loud and they heard. Your reply MUST:
1. Briefly acknowledge the interruption (e.g. "yeah, go ahead", "of course", "sure thing") — do NOT scold, do NOT ignore it.
2. Address what they just said.
3. END with a short offer to resume from where you left off — e.g. "want me to pick back up from where I was?" or "ready to keep going from there?". DO NOT silently restart the explanation from scratch.

WHAT YOU HAD ALREADY SAID (verbatim, do not re-read):
"""
${input.interruptedAfter.trim().slice(0, 800)}
"""`
      : "";

  // Smart-pacing signals. These get woven into the timing guidance
  // section so Rose can decide WHEN to ask a check question instead
  // of asking on every turn.
  const pacingLines: string[] = [];
  if (
    typeof input.secondsSinceLastCheck === "number" &&
    Number.isFinite(input.secondsSinceLastCheck)
  ) {
    pacingLines.push(
      `- Seconds since your LAST check question: ${Math.round(input.secondsSinceLastCheck)}s`
    );
  }
  if (
    typeof input.secondsSinceStudentSpoke === "number" &&
    Number.isFinite(input.secondsSinceStudentSpoke)
  ) {
    pacingLines.push(
      `- Seconds since the student LAST spoke: ${Math.round(input.secondsSinceStudentSpoke)}s`
    );
  }
  const pacingBlock = pacingLines.length
    ? `

PACING SIGNALS (use to decide if a check question is appropriate this turn):
${pacingLines.join("\n")}

Smart-timing rules:
- The "30 second" rule means: don't pile on a SECOND new check right after one you already asked. It does NOT mean "stop talking and leave the student hanging."
- If the student has NOT actually answered the check question yet (vague "ok", "yeah", "got it", "makes sense" without substance), you MUST re-ask or invite an answer — even if a check was asked recently.
- If you've been explaining ~60+ seconds with no real answer, still steer back to the CHECK QUESTION — not a different "does that make sense?" prompt.
- DON'T interrupt their flow if they just gave a substantive correct answer.
- Major-concept transitions are a natural place for a check — verify before building further.`
    : "";

  const checkStatusBlock =
    input.attempts > 0
      ? `
CHECK QUESTION STATUS: The student has already attempted an answer on this chunk (attempt ${input.attempts + 1}).`
      : input.chunkTeachingStarted === false
        ? `
SESSION START: You have NOT taught this chunk yet — the student is still responding to your welcome ("ready to dive in?"). Their message is almost certainly a casual "yes / let's go", NOT an answer to the CHECK QUESTION below. Reply with brief warm acknowledgment, then BEGIN teaching the CONCEPT naturally (use the EXPLANATION as your guide). Classify as check_in with "advance": false — do NOT scold, do NOT re-ask the check question, do NOT demand they walk through their thinking.`
        : `
CHECK QUESTION STATUS: The student has NOT yet answered the check question for this chunk. Their latest message probably does NOT count as an answer unless they explained the idea in their own words.`;

  const languageBlock = formatMentoredTeachingLanguageBlock(
    input.outputLanguage ?? "auto"
  );

  return `You are an AI tutor mid-lesson. The student is on this CHUNK:

${languageBlock}

CONCEPT: ${input.chunk.concept}
EXPLANATION YOU JUST GAVE: ${input.chunk.explanation}
ANALOGY (optional fallback): ${input.chunk.analogy ?? "(none)"}
CHECK QUESTION YOU JUST ASKED: ${input.chunk.checkQuestion}
REFERENCE ANSWER (internal — never read this aloud verbatim): ${input.chunk.referenceAnswer}
KEY POINTS THE ANSWER SHOULD HIT: ${input.chunk.keyPoints.join("; ")}
ATTEMPT NUMBER FOR THIS CHUNK: ${input.attempts + 1}
STUDENT LEVEL: ${input.knowledgeLevel}${personalizationBlock ? `\n\n${personalizationBlock}` : ""}${checkStatusBlock}${interruptedBlock}${pacingBlock}

STUDENT JUST SAID: """
${input.studentUtterance.trim().slice(0, 2000)}
"""

Output format (STRICT):
1. First, write your spoken reply as plain text. Conversational tutor voice. No markdown, no "as an AI", no quotes around it.
   - Usually 2-5 sentences; stay concise unless a short example is needed.
   - TEACH LIKE A HUMAN TUTOR: you do NOT need to interrogate the student after every concept. For light or intuitive concepts, a soft check-in ("does that make sense so far?", "with me?") is enough — if they say yes, you may move on (intent check_in, advance:true).
   - WHEN TO USE THE FORMAL CHECK QUESTION: reserve the CHECK QUESTION above for moments that matter — a genuinely KEY or tricky concept, a major-concept transition, when the student seems unsure/quiet, or when they gave a vague answer to a soft check-in on something important. When you ask it, ask THAT check question (light paraphrase OK) — not a different graded question.
   - Once you HAVE posed the formal check question, keep ending on it until they answer it substantively (don't swap in a softer substitute mid-check).
   - Use the PACING SIGNALS to avoid piling questions back-to-back; don't ask a brand-new check right after one you already asked.
   - Do NOT say "you nailed it", "exactly right", or "you've got it" unless the student actually demonstrated understanding OR you are advancing.
2. WHITEBOARD (optional, mid-reply): When you draw on the board WHILE explaining, insert inline markers at the moment you would draw — NOT all at the end. Format: on its own line write ${TURN_WB_SENTINEL} then a JSON array of 1–2 actions. Action types: show_table (anchor source table), highlight_bbox {bbox:[x,y,w,h]}, draw_arrow {from:{x,y},to:{x,y}}, add_label {text,position:{x,y}}, clear, clear_except {keepIds:[]}. Coords 0–100. Colors: excitatory|inhibitory|highlight. Each action should include a short "cue" phrase you just said (for sync). Place markers BETWEEN sentences at the teaching moment. Do NOT dump all overlays at once.
3. Then on a new line write exactly: ${TURN_META_SENTINEL}
4. Then on a new line emit a JSON object with classification + any remaining whiteboard actions not yet streamed:
{"intent":"answer_correct|...|other","advance":true|false,"addToFocusedReview":true|false,"whiteboardActions":[...]|[]}

whiteboardActions in META: only actions you did NOT already stream via ${TURN_WB_SENTINEL}. Usually [].

Example:
Let me circle the key column on the table.
${TURN_WB_SENTINEL}
[{"type":"show_table","cue":"key column"},{"type":"highlight_bbox","bbox":[12,8,28,72],"color":"highlight","cue":"key column"}]
Nice work — you nailed the key idea there. Let's keep going.
${TURN_META_SENTINEL}
{"intent":"answer_correct","advance":true,"addToFocusedReview":false,"whiteboardActions":[]}

CRITICAL — when NOT to advance:
- If your spoken reply ENDS with a question that asks the student
  for input ("do you want to review X?", "should we move on?",
  "want to keep going?", "shall I cover Y next?"), set
  "advance":false. Wait for the student to actually answer. Do not
  ask a question AND advance in the same turn — the student will
  see Rose skip past their answer.
- If you want to advance, end with a statement, NOT a question.

Guidelines for classification + reply tone:
- check_in → the student acknowledged a SOFT check-in ("ok", "yeah", "got it", "makes sense", "I follow") AND this concept is light/intuitive enough that you're comfortable moving on without a formal quiz. Acknowledge warmly and continue. "advance": true. Use this to keep the lesson flowing like a real conversation — NOT every concept needs a graded question.
- Vague affirmatives on a KEY or tricky concept (or right after you posed the formal CHECK QUESTION) → answer_partial, "advance": false. Briefly invite them to say it in their own words via the CHECK QUESTION (paraphrase OK). Use judgment: reserve this for concepts where real comprehension actually matters.
- answer_correct → when they demonstrate real understanding (hits key points or a solid paraphrase). Praise briefly, "advance": true, end with a statement (not a question).
- answer_partial → name what they got right, fill the gap, then re-ask the CHECK QUESTION. "advance": false.
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

Tone: real human tutor. Conversational. Never lecture-y. Teach from the source material naturally — rephrase, give examples, connect to things the student might already know. Do not read text verbatim. Pace yourself; this is not a race.

Never deliver a monologue and stop — always leave the student with a clear question to respond to unless you are advancing.`;
}

function parseTurnMetaJson(
  raw: string,
  intentFallback: MentoredIntent = "other"
): {
  intent: MentoredIntent;
  advance: boolean;
  addToFocusedReview: boolean;
  whiteboardActions: WhiteboardAction[];
} {
  // Tolerate stray prose around the JSON by extracting the first balanced
  // brace block. If parsing fails entirely, fall back to sensible defaults.
  const trimmed = stripJsonFence(raw).trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  try {
    const parsed = JSON.parse(slice) as Record<string, unknown>;
    const intent: MentoredIntent = isIntent(parsed.intent)
      ? parsed.intent
      : intentFallback;
    return {
      intent,
      advance:
        parsed.advance === true ||
        intent === "answer_correct" ||
        intent === "skip_concept" ||
        intent === "move_on",
      addToFocusedReview: parsed.addToFocusedReview === true,
      whiteboardActions: parseWhiteboardActions(parsed.whiteboardActions),
    };
  } catch {
    return {
      intent: intentFallback,
      advance: false,
      addToFocusedReview: false,
      whiteboardActions: [],
    };
  }
}

export async function runMentoredTurn(input: TurnInput): Promise<TurnOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 700,
    temperature: 0.5,
    messages: [{ role: "user", content: buildTurnPrompt(input) }],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }
  const full = block.text;
  const sentinelIdx = full.indexOf(TURN_META_SENTINEL);
  const replyText =
    sentinelIdx >= 0 ? full.slice(0, sentinelIdx).trim() : full.trim();
  const metaText = sentinelIdx >= 0 ? full.slice(sentinelIdx + TURN_META_SENTINEL.length) : "";
  const meta = parseTurnMetaJson(metaText, "other");
  const reply = replyText.length > 0 ? replyText : "Let's keep going.";
  return { reply, ...meta };
}

/**
 * Streaming variant of `runMentoredTurn`. Yields:
 *
 *   { type: "text", delta }   — reply tokens, as Claude emits them
 *   { type: "meta", ... }     — classification (intent/advance/focused), once
 *                                the trailing metadata JSON has been parsed
 *
 * The route handler relays these as SSE events so the client can start
 * speaking the reply BEFORE Claude finishes — first audible token in
 * 1-2s instead of waiting the full ~3-6s for the whole turn.
 */
function tryParseInlineWhiteboardJson(
  slice: string
): { actions: WhiteboardAction[]; consumed: number } | null {
  const trimmed = slice.trimStart();
  const offset = slice.length - trimmed.length;
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    const actions = parseWhiteboardActions(parsed);
    if (actions.length === 0) return null;
    const consumed = offset + end + 1;
    return { actions, consumed };
  } catch {
    return null;
  }
}

const SENTINEL_HOLD_BACK = Math.max(
  TURN_META_SENTINEL.length,
  TURN_WB_SENTINEL.length
);

export async function* runMentoredTurnStream(input: TurnInput): AsyncGenerator<
  | { type: "text"; delta: string }
  | { type: "whiteboard"; actions: WhiteboardAction[] }
  | {
      type: "meta";
      intent: MentoredIntent;
      advance: boolean;
      addToFocusedReview: boolean;
      whiteboardActions: WhiteboardAction[];
    },
  void,
  void
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const stream = anthropic.messages.stream({
    model: FAST_MODEL,
    max_tokens: 700,
    temperature: 0.5,
    messages: [{ role: "user", content: buildTurnPrompt(input) }],
  });

  let buffered = "";
  type StreamPhase = "reply" | "wb" | "meta";
  const streamState = { phase: "reply" as StreamPhase };
  let cursor = 0;

  const processReplyBuffer = function* (): Generator<
    | { type: "text"; delta: string }
    | { type: "whiteboard"; actions: WhiteboardAction[] },
    void,
    void
  > {
    while (streamState.phase === "reply" && cursor < buffered.length) {
      const wbIdx = buffered.indexOf(TURN_WB_SENTINEL, cursor);
      const metaIdx = buffered.indexOf(TURN_META_SENTINEL, cursor);
      let nextIdx = -1;
      let nextKind: "wb" | "meta" | null = null;
      if (wbIdx >= 0 && (metaIdx < 0 || wbIdx <= metaIdx)) {
        nextIdx = wbIdx;
        nextKind = "wb";
      } else if (metaIdx >= 0) {
        nextIdx = metaIdx;
        nextKind = "meta";
      }

      if (nextIdx < 0) {
        const safeUpTo = Math.max(cursor, buffered.length - SENTINEL_HOLD_BACK);
        const tail = buffered.slice(cursor, safeUpTo);
        cursor = safeUpTo;
        if (tail) yield { type: "text", delta: tail };
        return;
      }

      const before = buffered.slice(cursor, nextIdx);
      cursor = nextIdx;
      if (before) yield { type: "text", delta: before };

      if (nextKind === "wb") {
        cursor += TURN_WB_SENTINEL.length;
        streamState.phase = "wb";
        const parsed = tryParseInlineWhiteboardJson(buffered.slice(cursor));
        if (parsed) {
          yield { type: "whiteboard", actions: parsed.actions };
          cursor += parsed.consumed;
          streamState.phase = "reply";
        }
        continue;
      }

      cursor += TURN_META_SENTINEL.length;
      streamState.phase = "meta";
      return;
    }

    if (streamState.phase === "wb") {
      const parsed = tryParseInlineWhiteboardJson(buffered.slice(cursor));
      if (parsed) {
        yield { type: "whiteboard", actions: parsed.actions };
        cursor += parsed.consumed;
        streamState.phase = "reply";
      }
    }
  };

  for await (const event of stream) {
    if (
      event.type !== "content_block_delta" ||
      event.delta.type !== "text_delta" ||
      !event.delta.text
    ) {
      continue;
    }
    buffered += event.delta.text;
    if (streamState.phase !== "meta") {
      yield* processReplyBuffer();
    }
  }

  if (streamState.phase === "reply") {
    const tail = buffered.slice(cursor);
    cursor = buffered.length;
    if (tail) yield { type: "text", delta: tail };
  } else if (streamState.phase === "wb") {
    yield* processReplyBuffer();
    const tail = buffered.slice(cursor);
    cursor = buffered.length;
    if (tail) yield { type: "text", delta: tail };
  }

  const metaAt = buffered.indexOf(TURN_META_SENTINEL, cursor);
  if (metaAt >= 0) {
    const tail = buffered.slice(cursor, metaAt);
    if (tail) yield { type: "text", delta: tail };
    cursor = metaAt + TURN_META_SENTINEL.length;
    streamState.phase = "meta";
  }

  if (streamState.phase !== "meta") {
    yield {
      type: "meta",
      intent: "other",
      advance: false,
      addToFocusedReview: false,
      whiteboardActions: [],
    };
    return;
  }

  const meta = parseTurnMetaJson(buffered.slice(cursor), "other");
  yield {
    type: "meta",
    intent: meta.intent,
    advance: meta.advance,
    addToFocusedReview: meta.addToFocusedReview,
    whiteboardActions: meta.whiteboardActions,
  };
}

// ---------------------------------------------------------------------------
// 4. Session opening greeting — short, warm, conversational
// ---------------------------------------------------------------------------

export type SessionGreetingInput = {
  /** Course title, used in the warm welcome. */
  courseTitle: string;
  /** Course one-liner. Optional — when missing we skip the "what we'll
   *  cover" beat instead of inventing one. */
  courseDescription?: string;
  /** Title of the first lesson the student will hit on continuation —
   *  used when we naturally transition into the lesson. */
  firstLessonTitle?: string;
  /** Where the student is in the course. Drives first-time vs returning
   *  framing in the prompt. */
  scenario: "first_time" | "returning" | "all_complete";
  /** For returning users only — the title of the last lesson/concept
   *  they actually worked on. Falls back to a generic "Welcome back"
   *  framing in the prompt when missing. */
  lastLessonTitle?: string;
  /** Self-study goal — personalize the greeting when present. */
  studyContext?: string;
  /** Course output / teaching language from upload settings. */
  outputLanguage?: CourseOutputLanguage;
};

const GREETING_SYSTEM = `You are Rose, a friendly, encouraging AI tutor inside a one-on-one Mentored Learning session. Generate a brief, warm GREETING for a student who just opened a course. Sound human and conversational, like a real tutor would when a student walks in. Do not use overly formal language. Do not list bullet points. Do not say "as an AI". Do not narrate what you'll do — just greet them.

Hard constraints:
- 2 to 3 sentences, max ~35 words.
- One greeting line + one personalized line. Optionally one short follow-up question.
- No markdown, no quotes around the output.
- Use the course title verbatim if it fits naturally.
- Vary phrasing — do not start with the same opener every time.
- Never invent a "last lesson" if one wasn't given. If returning with no last lesson, just welcome them back without referencing a specific section.

CRITICAL — match the SCENARIO exactly. The phrasing rule is non-negotiable:
- "first_time" scenario → the student has NEVER opened this course before. DO NOT use "welcome back", "good to see you again", "let's continue", "pick up where we left off", or any phrasing that implies a prior session. Acceptable openers: "Welcome to…", "Hey, welcome!", "Glad you're here", "Alright, ready to dive in?", "First time here? Cool…".
- "returning" scenario → the student HAS worked on this course before. Acceptable openers: "Welcome back", "Hey, good to see you again", "You're back!", "Picking up where we left off…".
- "all_complete" scenario → the student has finished the whole course. Acknowledge completion warmly. Do NOT reference an unfinished lesson.`;

/**
 * Generates the spoken greeting the AI tutor plays the moment the
 * student opens Mentored Learning. Uses the fast Haiku model so it's
 * ready within ~1s of session load.
 */
export async function generateSessionGreeting(
  input: SessionGreetingInput
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const desc = input.courseDescription?.trim()
    ? `\nCOURSE DESCRIPTION (use only if it fits naturally — do NOT recite verbatim):\n${input.courseDescription.trim().slice(0, 400)}`
    : "\n(No course description available — do not mention course content specifics.)";

  const studyBlock = input.studyContext?.trim()
    ? `\nSTUDENT'S STUDY GOAL (mention ONE focus area naturally if it fits — do NOT read a list):\n${input.studyContext.trim().slice(0, 500)}`
    : "";

  const scenarioBlock = (() => {
    switch (input.scenario) {
      case "first_time":
        return `SCENARIO: First-time opening this course.
Tone: welcoming, warm, "let's get started" energy. Optionally invite them to begin (e.g. "ready to dive in?"). Reference the course title.${input.firstLessonTitle ? `\n(First lesson coming up is "${input.firstLessonTitle}" — only mention it if it makes the greeting flow more naturally.)` : ""}`;
      case "returning":
        return `SCENARIO: Returning student — they've worked on this course before.
Tone: "good to see you back" warmth.${
          input.lastLessonTitle
            ? `\nLAST LESSON THEY WORKED ON: "${input.lastLessonTitle}". Reference it briefly when asking if they want to keep going.`
            : `\n(No last-lesson title available — just welcome them back and ask if they want to keep going. Do not invent a specific topic.)`
        }`;
      case "all_complete":
        return `SCENARIO: The student has worked through every lesson in this course already.
Tone: cheerful "look who's back, you finished it!" Warmly acknowledge the completion and ask if they want to review anything specific or quiz themselves. Do NOT reference an unfinished lesson.`;
    }
  })();

  const languageBlock = formatMentoredTeachingLanguageBlock(
    input.outputLanguage ?? "auto"
  );

  const user = `${languageBlock}

COURSE TITLE: ${input.courseTitle.slice(0, 200)}${desc}${studyBlock}

${scenarioBlock}

Output ONLY the greeting text Rose should say out loud in the required teaching language. No preamble, no closing tag, no quotes.`;

  const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 180,
    temperature: 0.85,
    system: GREETING_SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response from Claude");
  }
  const raw = block.text.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!raw) {
    throw new Error("Empty greeting from Claude");
  }
  // Safety cap — never let a runaway response play more than ~25s of speech.
  return raw.length > 400 ? `${raw.slice(0, 400).trim()}…` : raw;
}

// ---------------------------------------------------------------------------
// 5. Knowledge-level inference from the onboarding quiz score
// ---------------------------------------------------------------------------

export function inferKnowledgeLevel(scorePct: number): KnowledgeLevel {
  if (scorePct >= 80) return "advanced";
  if (scorePct >= 50) return "intermediate";
  return "beginner";
}

// ---------------------------------------------------------------------------
// 7. Lesson image classifier
// ---------------------------------------------------------------------------

/**
 * Decides whether a given lesson would actually benefit from a
 * visual, and — if so — what kind and what to search for. Used by
 * the `/api/study-materials/.../lesson-image` route to lazily
 * classify lessons on first render.
 *
 * Output:
 *   { needsImage, searchQuery, imageType }
 *
 * Per spec, MANY lessons don't need images:
 *   - English grammar / vocab / writing
 *   - Abstract concepts without a clear visual representation
 *   - Math equations (rendered by text already)
 * The classifier is biased toward `needsImage: false` — we'd rather
 * have a clean text-only lesson than a tangentially-related stock
 * photo.
 */

export type LessonImageClassification = {
  needsImage: boolean;
  searchQuery: string;
  imageType: "diagram" | "photo" | "illustration";
};

const LESSON_IMAGE_CLASSIFIER_SYSTEM = `You decide whether a lesson on a learning platform should have an accompanying image, and what to search for if so. Output ONLY a JSON object.

Output shape EXACTLY:
{"needsImage": boolean, "searchQuery": string, "imageType": "diagram"|"photo"|"illustration"}

Rules:
- Set needsImage to TRUE only when a visual genuinely improves comprehension. Examples: anatomy ("structure of the heart"), processes ("water cycle"), historical figures, geography, biology specimens, mechanical/electrical schematics.
- Set needsImage to FALSE for: English grammar, vocabulary lists, abstract logic, programming syntax, math equations, pure prose / philosophy, anything that doesn't clearly map to a real-world picture.
- searchQuery: a SHORT noun phrase (≤ 50 chars), no quotes, no punctuation, that you'd type into Wikipedia to find the most relevant educational image. Example: "human heart anatomy", "amazon rainforest", "World War II tanks".
- imageType: "diagram" for processes/anatomy/schematics, "photo" for real-world objects/places/people, "illustration" for abstract concepts that have a conventional visual.
- When needsImage is FALSE, set searchQuery to "" and imageType to "illustration" (placeholder values — they won't be used).

Bias toward FALSE when uncertain. A clean text lesson is better than a tangentially-related image.`;

export async function classifyLessonImage(input: {
  lessonTitle: string;
  lessonContent: string;
  courseTitle: string;
}): Promise<LessonImageClassification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { needsImage: false, searchQuery: "", imageType: "illustration" };
  }

  const content = input.lessonContent.trim().slice(0, 1500);
  const user = `COURSE TITLE: ${input.courseTitle.trim().slice(0, 200)}
LESSON TITLE: ${input.lessonTitle.trim().slice(0, 200)}
LESSON BODY (truncated):
"""
${content}
"""

Classify now.`;

  try {
    const anthropic = new Anthropic({
      apiKey,
      timeout: 15_000,
      maxRetries: 0,
    });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 150,
      temperature: 0.1,
      system: LESSON_IMAGE_CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: user }],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return { needsImage: false, searchQuery: "", imageType: "illustration" };
    }
    const raw = stripJsonFence(block.text).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return { needsImage: false, searchQuery: "", imageType: "illustration" };
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const needsImage = parsed.needsImage === true;
    const searchQuery =
      typeof parsed.searchQuery === "string"
        ? parsed.searchQuery.trim().slice(0, 80)
        : "";
    const t =
      parsed.imageType === "diagram"
        ? "diagram"
        : parsed.imageType === "photo"
          ? "photo"
          : "illustration";
    if (!needsImage || !searchQuery) {
      return { needsImage: false, searchQuery: "", imageType: t };
    }
    return { needsImage: true, searchQuery, imageType: t };
  } catch (e) {
    console.error("[classifyLessonImage]", e);
    return { needsImage: false, searchQuery: "", imageType: "illustration" };
  }
}

// ---------------------------------------------------------------------------
// 6. Personalization extraction from free-text onboarding answers
// ---------------------------------------------------------------------------

const PERSONALIZATION_SYSTEM = `You extract STRUCTURED personalization signals from a student's free-text onboarding answers. You read short answers about their motivation, prior familiarity, and what they want the tutor to focus on, and emit a JSON object that drives an AI tutor's pacing and depth.

Hard requirements:
- Output ONLY a JSON object. No prose, no markdown fences, no preamble.
- Shape EXACTLY: {"knownTopics": string[], "focusAreas": string[], "experienceLevel": "beginner"|"intermediate"|"advanced", "summary": string}
- knownTopics: up to 6 short noun-phrase topics the student says they ALREADY understand or have prior exposure to. Empty array when nothing was indicated. Lowercase. Examples: ["basic calculus", "python syntax"].
- focusAreas: up to 6 short noun-phrase topics they want the tutor to spend extra time on. Empty array when not indicated. Lowercase.
- experienceLevel: best guess from the answers. Default to "beginner" when unclear. "intermediate" when they mention some prior exposure / coursework / partial fluency. "advanced" only when they say things like "I work in this field" / "I've taught this before" / "PhD-level".
- summary: ONE sentence (≤ 200 chars), natural-language, used as direct prompt-paste-in. Always start with "Student" and describe their goal + experience in plain English, e.g. "Student is studying for a final exam in two weeks and feels shaky on integration techniques." Never use markdown.

Be conservative — do not invent topics they didn't mention.`;

export type PersonalizationInput = {
  goals: GoalsAnswer[];
  /** Quiz-derived level acts as a prior — used when the free-text
   *  answers don't clearly indicate experience. */
  quizLevel?: KnowledgeLevel;
};

/**
 * Extracts structured personalization from the goals/background
 * free-text answers. Returns an empty object on failure (caller
 * should treat as "no personalization yet" and fall back to the
 * quiz-derived knowledge level).
 *
 * Uses the fast Haiku model — extraction needs to run in ~1s on
 * first turn so it doesn't add latency to Rose's first reply.
 */
export async function extractPersonalization(
  input: PersonalizationInput
): Promise<MentoredPersonalization> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  // No goals to extract from — bail with an experienceLevel hint
  // from the quiz so the prompt isn't totally blind.
  const usable = input.goals.filter(
    (g) => g.answer && g.answer.trim().length > 0
  );
  if (usable.length === 0) {
    return input.quizLevel
      ? { experienceLevel: input.quizLevel }
      : {};
  }

  const answersBlock = usable
    .map(
      (g, i) =>
        `${i + 1}. Q: ${g.question.trim().slice(0, 200)}\n   A: ${g.answer.trim().slice(0, 500)}`
    )
    .join("\n");

  const quizHint = input.quizLevel
    ? `\n\nQuiz-derived knowledge level (prior): ${input.quizLevel}`
    : "";

  const user = `STUDENT ONBOARDING ANSWERS:\n${answersBlock}${quizHint}\n\nExtract personalization now.`;

  const anthropic = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 400,
    temperature: 0.2,
    system: PERSONALIZATION_SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    return input.quizLevel ? { experienceLevel: input.quizLevel } : {};
  }
  const raw = stripJsonFence(block.text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return input.quizLevel ? { experienceLevel: input.quizLevel } : {};
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const out: MentoredPersonalization = {};
    if (Array.isArray(parsed.knownTopics)) {
      out.knownTopics = parsed.knownTopics
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
        .slice(0, 6);
    }
    if (Array.isArray(parsed.focusAreas)) {
      out.focusAreas = parsed.focusAreas
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
        .slice(0, 6);
    }
    if (
      parsed.experienceLevel === "beginner" ||
      parsed.experienceLevel === "intermediate" ||
      parsed.experienceLevel === "advanced"
    ) {
      out.experienceLevel = parsed.experienceLevel;
    } else if (input.quizLevel) {
      out.experienceLevel = input.quizLevel;
    }
    if (typeof parsed.summary === "string") {
      out.summary = parsed.summary.trim().slice(0, 280);
    }
    return out;
  } catch {
    return input.quizLevel ? { experienceLevel: input.quizLevel } : {};
  }
}
