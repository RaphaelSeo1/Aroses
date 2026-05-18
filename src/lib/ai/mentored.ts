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

// Sentinel separating spoken reply text from trailing metadata JSON in
// the streaming prompt format. Anything before the sentinel is read
// aloud / displayed; anything after gets parsed as classification.
const TURN_META_SENTINEL = "---META---";

function buildTurnPrompt(input: TurnInput): string {
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
- DO NOT ask a check question if the previous check was less than ~30 seconds ago. Just keep teaching.
- DO consider a check question if it's been ~90+ seconds of you talking with no check-in.
- DO consider a gentle check-in ("you still with me?") if the student has been silent ~60+ seconds AND you're mid-explanation.
- DON'T interrupt their flow if they're asking their own questions or just answered correctly.
- Major-concept transitions are a natural place for a check — verify before building further.`
    : "";

  return `You are an AI tutor mid-lesson. The student is on this CHUNK:

CONCEPT: ${input.chunk.concept}
EXPLANATION YOU JUST GAVE: ${input.chunk.explanation}
ANALOGY (optional fallback): ${input.chunk.analogy ?? "(none)"}
CHECK QUESTION YOU JUST ASKED: ${input.chunk.checkQuestion}
REFERENCE ANSWER (internal — never read this aloud verbatim): ${input.chunk.referenceAnswer}
KEY POINTS THE ANSWER SHOULD HIT: ${input.chunk.keyPoints.join("; ")}
ATTEMPT NUMBER FOR THIS CHUNK: ${input.attempts + 1}
STUDENT LEVEL: ${input.knowledgeLevel}${interruptedBlock}${pacingBlock}

STUDENT JUST SAID: """
${input.studentUtterance.trim().slice(0, 2000)}
"""

Output format (STRICT):
1. First, write your spoken reply as plain text. 1-4 sentences. Conversational tutor voice. No markdown, no "as an AI", no quotes around it.
2. Then on a new line write exactly: ${TURN_META_SENTINEL}
3. Then on a new line emit a JSON object with classification:
{"intent":"answer_correct|answer_partial|answer_wrong|pace_slower|pace_faster|skip_concept|move_on|tangent_question|request_repeat|request_pause|request_clarify|other","advance":true|false,"addToFocusedReview":true|false}

Example:
Nice work — you nailed the key idea there. Want to move on?
${TURN_META_SENTINEL}
{"intent":"answer_correct","advance":true,"addToFocusedReview":false}

Guidelines for classification + reply tone:
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

Tone: real human tutor. Conversational. Never lecture-y. Teach from the source material naturally — rephrase, give examples, connect to things the student might already know. Do not read text verbatim. Pace yourself; this is not a race.`;
}

function parseTurnMetaJson(
  raw: string,
  intentFallback: MentoredIntent = "other"
): { intent: MentoredIntent; advance: boolean; addToFocusedReview: boolean } {
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
    };
  } catch {
    return { intent: intentFallback, advance: false, addToFocusedReview: false };
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
  const meta = parseTurnMetaJson(metaText);
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
export async function* runMentoredTurnStream(input: TurnInput): AsyncGenerator<
  | { type: "text"; delta: string }
  | { type: "meta"; intent: MentoredIntent; advance: boolean; addToFocusedReview: boolean },
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

  // We accumulate the entire stream so we can detect the sentinel safely
  // across token boundaries (e.g. Claude might split "---META---" across
  // two deltas). Anything BEFORE the sentinel is forwarded as text; once
  // we see the sentinel we stop forwarding text and start buffering for
  // metadata.
  let buffered = "";
  let inMeta = false;
  let textForwardedUpTo = 0;

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta" &&
      event.delta.text
    ) {
      buffered += event.delta.text;

      if (!inMeta) {
        const idx = buffered.indexOf(TURN_META_SENTINEL);
        if (idx >= 0) {
          // Flush any text up to the sentinel, then switch to meta mode.
          const tail = buffered.slice(textForwardedUpTo, idx);
          if (tail) yield { type: "text", delta: tail };
          inMeta = true;
          textForwardedUpTo = idx + TURN_META_SENTINEL.length;
        } else {
          // Hold back the last few chars in case the sentinel is straddling
          // a chunk boundary. 16 chars is plenty (sentinel is 11 chars).
          const safeUpTo = Math.max(textForwardedUpTo, buffered.length - 16);
          if (safeUpTo > textForwardedUpTo) {
            yield {
              type: "text",
              delta: buffered.slice(textForwardedUpTo, safeUpTo),
            };
            textForwardedUpTo = safeUpTo;
          }
        }
      }
    }
  }

  if (!inMeta) {
    // Sentinel never showed up — flush remaining text and emit best-guess meta.
    const tail = buffered.slice(textForwardedUpTo);
    if (tail) yield { type: "text", delta: tail };
    yield {
      type: "meta",
      intent: "other",
      advance: false,
      addToFocusedReview: false,
    };
    return;
  }

  const metaSlice = buffered.slice(textForwardedUpTo);
  const meta = parseTurnMetaJson(metaSlice);
  yield {
    type: "meta",
    intent: meta.intent,
    advance: meta.advance,
    addToFocusedReview: meta.addToFocusedReview,
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

  const user = `COURSE TITLE: ${input.courseTitle.slice(0, 200)}${desc}

${scenarioBlock}

Output ONLY the greeting text Rose should say out loud. No preamble, no closing tag, no quotes.`;

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
