import Anthropic from "@anthropic-ai/sdk";
import {
  normalizeQuizItemsLoose,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import { tutorChatModel } from "@/lib/ai/anthropic-models";
import type {
  CourseQuizFreeItem,
  CourseQuizItem,
  CourseQuizMcqItem,
} from "@/types/course";
import { isQuizFreeResponse, isQuizMcq } from "@/types/course";

const QUIZ_ARRAY_KEYS = [
  "questions",
  "items",
  "quiz",
  "mcqs",
  "practice_questions",
] as const;

const MAX_CONTEXT_CHARS = 12_000;

export type PersonalQuizType = "mcq" | "free_response";

export type PersonalQuizTypeCounts = {
  mcq: number;
  freeResponse: number;
};

const EMPTY_TYPE_COUNTS: PersonalQuizTypeCounts = {
  mcq: 0,
  freeResponse: 0,
};

function targetQuestionCount(count: number): number {
  return Math.min(12, Math.max(3, Math.floor(count)));
}

/**
 * Build a balanced batch. For an odd batch, give the extra slot to the
 * learner's currently underrepresented type; an exact tie starts with FRQ.
 * The next odd batch then favors MCQ, so repeated actions alternate naturally.
 */
export function planPersonalQuizTypes(
  count: number,
  existing: PersonalQuizTypeCounts = EMPTY_TYPE_COUNTS
): PersonalQuizType[] {
  const total = targetQuestionCount(count);
  const half = Math.floor(total / 2);
  let mcq = half;
  let freeResponse = half;

  if (total % 2 === 1) {
    if (existing.mcq < existing.freeResponse) mcq += 1;
    else freeResponse += 1;
  }

  const first: PersonalQuizType =
    freeResponse > mcq ||
    (freeResponse === mcq && existing.freeResponse <= existing.mcq)
      ? "free_response"
      : "mcq";
  const plan: PersonalQuizType[] = [];
  let next = first;
  while (mcq > 0 || freeResponse > 0) {
    if (next === "mcq" && mcq > 0) {
      plan.push("mcq");
      mcq -= 1;
    } else if (next === "free_response" && freeResponse > 0) {
      plan.push("free_response");
      freeResponse -= 1;
    } else if (mcq > 0) {
      plan.push("mcq");
      mcq -= 1;
    } else {
      plan.push("free_response");
      freeResponse -= 1;
    }
    next = next === "mcq" ? "free_response" : "mcq";
  }
  return plan;
}

export function countPersonalQuizTypes(
  rows: Array<{ item?: unknown }>
): PersonalQuizTypeCounts {
  const counts = { ...EMPTY_TYPE_COUNTS };
  for (const row of rows) {
    const item = row.item;
    if (
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "free_response"
    ) {
      counts.freeResponse += 1;
    } else {
      counts.mcq += 1;
    }
  }
  return counts;
}

/** Common words dropped when comparing question stems for near-duplicates. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "best",
  "most",
  "describe",
  "following",
  "true",
  "about",
  "than",
  "then",
  "such",
  "each",
  "other",
]);

function significantTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function normalizeStem(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Drop MCQs whose stems target the same underlying fact as an earlier item. */
export function dedupePersonalMcqs(
  items: CourseQuizMcqItem[],
  opts?: { jaccardThreshold?: number; minStemChars?: number }
): CourseQuizMcqItem[] {
  const jThresh = opts?.jaccardThreshold ?? 0.34;
  const minStem = opts?.minStemChars ?? 24;

  const kept: CourseQuizMcqItem[] = [];
  const stems: string[] = [];
  const tokenSets: Set<string>[] = [];
  const correctKeys: string[] = [];

  for (const item of items) {
    const stem = normalizeStem(item.question);
    if (stem.length < 12) {
      kept.push(item);
      stems.push(stem);
      tokenSets.push(significantTokens(item.question));
      correctKeys.push(normalizeStem(item.correct));
      continue;
    }

    const t = significantTokens(item.question);
    const corrNorm = normalizeStem(item.correct);
    let duplicate = false;

    for (let i = 0; i < kept.length; i++) {
      if (
        corrNorm.length >= 8 &&
        corrNorm === correctKeys[i] &&
        tokenJaccard(t, tokenSets[i]) >= 0.18
      ) {
        duplicate = true;
        break;
      }
      if (tokenJaccard(t, tokenSets[i]) >= jThresh) {
        duplicate = true;
        break;
      }
      if (stem.length >= minStem && stems[i].length >= minStem) {
        if (stem.includes(stems[i]) || stems[i].includes(stem)) {
          duplicate = true;
          break;
        }
      }
      const ca = normalizeStem(item.correct);
      const cb = normalizeStem(kept[i].correct);
      if (
        ca.length >= 10 &&
        cb.length >= 10 &&
        (ca === cb || ca.includes(cb) || cb.includes(ca)) &&
        tokenJaccard(t, tokenSets[i]) >= 0.22
      ) {
        duplicate = true;
        break;
      }
    }

    if (!duplicate) {
      kept.push(item);
      stems.push(stem);
      tokenSets.push(t);
      correctKeys.push(corrNorm);
    }
  }

  return kept;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function lightJsonFix(s: string): string {
  return s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function coerceQuizArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const o = parsed as Record<string, unknown>;
  for (const k of QUIZ_ARRAY_KEYS) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  if (typeof o.question === "string") return [o];
  return [];
}

/** Pull complete `{...}` objects out of a truncated or noisy JSON array. */
export function salvageJsonArray(raw: string): unknown[] {
  const start = raw.indexOf("[");
  if (start < 0) return [];
  const slice = raw.slice(start);
  const direct = tryParseJson(lightJsonFix(slice));
  if (Array.isArray(direct)) return direct;

  const items: unknown[] = [];
  let i = 1;
  while (i < slice.length) {
    while (i < slice.length && slice[i] !== "{") {
      if (slice[i] === "]") return items;
      i += 1;
    }
    if (i >= slice.length) break;
    const objStart = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;
    for (; i < slice.length; i++) {
      const c = slice[i]!;
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          const obj = tryParseJson(
            lightJsonFix(slice.slice(objStart, i + 1))
          );
          if (obj && typeof obj === "object") items.push(obj);
          i += 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) break;
  }
  return items;
}

/**
 * Models often wrap quiz JSON in fences, a `{ questions: [] }` object,
 * preamble, or a truncated last item. Recover whatever complete items we can.
 */
export function parsePersonalQuizModelText(raw: string): unknown[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let stripped = (fenced?.[1] ?? stripJsonFence(raw.trim())).trim();
  stripped = stripped.replace(/^```(?:json)?\s*/i, "").trim();

  const whole = tryParseJson(lightJsonFix(stripped));
  if (whole !== undefined) {
    const arr = coerceQuizArray(whole);
    if (arr.length > 0) return arr;
  }

  const startArr = stripped.indexOf("[");
  const startObj = stripped.indexOf("{");
  if (startArr >= 0 && (startObj < 0 || startArr <= startObj)) {
    const salvaged = salvageJsonArray(stripped);
    if (salvaged.length > 0) return salvaged;
  }
  if (startObj >= 0) {
    const end = stripped.lastIndexOf("}");
    if (end > startObj) {
      const obj = tryParseJson(
        lightJsonFix(stripped.slice(startObj, end + 1))
      );
      const arr = coerceQuizArray(obj);
      if (arr.length > 0) return arr;
    }
  }
  return salvageJsonArray(stripped);
}

function softenQuizItem(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const rawType =
    typeof o.type === "string" ? o.type.trim().toLowerCase() : "";
  const isFreeResponse = new Set([
    "free_response",
    "short_answer",
    "written",
    "essay",
    "open_ended",
    "long_answer",
    "frq",
    "open",
  ]).has(rawType);

  if (isFreeResponse) {
    if (
      typeof o.reference_answer !== "string" ||
      !o.reference_answer.trim()
    ) {
      if (typeof o.referenceAnswer === "string") {
        o.reference_answer = o.referenceAnswer;
      } else if (typeof o.answer === "string") {
        o.reference_answer = o.answer;
      } else if (typeof o.correct_answer === "string") {
        o.reference_answer = o.correct_answer;
      }
    }
    o.type = "free_response";
  }
  if (typeof o.correct !== "string" || !o.correct.trim()) {
    if (typeof o.answer === "string") o.correct = o.answer;
    else if (typeof o.correct_answer === "string") o.correct = o.correct_answer;
    else if (typeof o.correctAnswer === "string") o.correct = o.correctAnswer;
    else if (typeof o.correctIndex === "number" && o.correctIndex >= 0) {
      o.correct = String.fromCharCode(65 + Math.min(3, o.correctIndex));
    }
  }
  if (!Array.isArray(o.choices) && Array.isArray(o.options)) {
    o.choices = o.options;
  }
  if (Array.isArray(o.choices) && o.choices.length > 4) {
    o.choices = o.choices.slice(0, 4);
  }
  if (typeof o.type !== "string") {
    const ref =
      typeof o.reference_answer === "string"
        ? o.reference_answer.trim()
        : typeof o.referenceAnswer === "string"
          ? o.referenceAnswer.trim()
          : "";
    o.type = ref.length >= 6 ? "free_response" : "mcq";
  }
  if (typeof o.explanation !== "string") o.explanation = "";
  return o;
}

/**
 * Normalize model candidates and fill only their planned type slots.
 * A malformed FRQ is dropped; an extra MCQ can never silently replace it.
 */
export function selectPersonalQuizItems(
  raw: unknown[],
  plan: PersonalQuizType[]
): CourseQuizItem[] {
  const normalized = normalizeQuizItemsLoose(raw.map(softenQuizItem));
  const mcqs = dedupePersonalMcqs(normalized.filter(isQuizMcq));
  const freeResponses = dedupePersonalFreeResponses(
    normalized.filter(isQuizFreeResponse)
  );
  const usedStems: string[] = [];
  const usedTokens: Set<string>[] = [];

  const takeDistinct = <T extends CourseQuizItem>(bucket: T[]): T | undefined => {
    while (bucket.length > 0) {
      const item = bucket.shift()!;
      const stem = normalizeStem(item.question);
      const tokens = significantTokens(item.question);
      const duplicate = usedStems.some(
        (usedStem, i) =>
          stem === usedStem ||
          tokenJaccard(tokens, usedTokens[i]!) >= 0.4
      );
      if (duplicate) continue;
      usedStems.push(stem);
      usedTokens.push(tokens);
      return item;
    }
    return undefined;
  };

  const selected: CourseQuizItem[] = [];
  for (const type of plan) {
    const item =
      type === "mcq"
        ? takeDistinct(mcqs)
        : takeDistinct(freeResponses);
    if (item) selected.push(item);
  }
  return selected;
}

function dedupePersonalFreeResponses(
  items: CourseQuizFreeItem[]
): CourseQuizFreeItem[] {
  const kept: CourseQuizFreeItem[] = [];
  const tokens: Set<string>[] = [];
  for (const item of items) {
    const current = significantTokens(item.question);
    if (tokens.some((seen) => tokenJaccard(current, seen) >= 0.34)) continue;
    kept.push(item);
    tokens.push(current);
  }
  return kept;
}

function typeCounts(plan: PersonalQuizType[]): PersonalQuizTypeCounts {
  return {
    mcq: plan.filter((type) => type === "mcq").length,
    freeResponse: plan.filter((type) => type === "free_response").length,
  };
}

function missingTypes(
  selected: CourseQuizItem[],
  plan: PersonalQuizType[]
): PersonalQuizTypeCounts {
  const wanted = typeCounts(plan);
  const have = {
    mcq: selected.filter(isQuizMcq).length,
    freeResponse: selected.filter(isQuizFreeResponse).length,
  };
  return {
    mcq: Math.max(0, wanted.mcq - have.mcq),
    freeResponse: Math.max(0, wanted.freeResponse - have.freeResponse),
  };
}

function generationPrompt(opts: {
  corpus: string;
  mcq: number;
  freeResponse: number;
  avoidQuestions?: string[];
  brokenOutput?: string;
}): string {
  const total = opts.mcq + opts.freeResponse;
  const avoid =
    opts.avoidQuestions && opts.avoidQuestions.length > 0
      ? `\nDo not repeat these already accepted questions:\n${opts.avoidQuestions
          .map((question) => `- ${question}`)
          .join("\n")}\n`
      : "";
  const broken = opts.brokenOutput
    ? `\nThe previous output was malformed or had the wrong type mix. Do not copy its structural errors:\n${opts.brokenOutput.slice(0, 6_000)}\n`
    : "";

  return `You are writing practice quiz questions for ONE learner. Use ONLY the excerpts below — do not invent facts not grounded in this text.

LEARNER NOTES / HIGHLIGHTS:
${opts.corpus}

Task: Output a JSON array of EXACTLY ${total} questions: EXACTLY ${opts.mcq} multiple-choice and EXACTLY ${opts.freeResponse} free-response. Output ONLY the JSON array — no markdown fences, no commentary, no trailing text.
MCQ object: { "type": "mcq", "question": string, "choices": [4 strings], "correct": "A"|"B"|"C"|"D", "explanation": string }
Free-response object: { "type": "free_response", "question": string, "reference_answer": string, "explanation": string }

Strict rules (follow all):
1) TYPE COUNTS: Preserve the exact requested split. Never turn a free-response slot into multiple choice.
2) REFERENCE RUBRIC: Every free-response item must have a substantive natural-language reference_answer (1–3 sentences) stating the key ideas a correct answer should cover. It is used by a concept-focused AI grader.
3) DISTINCT FACTS: Each question must test a different main idea from the notes. Do not ask the same underlying fact twice using different wording.
4) ONE PROBE PER QUESTION: Pick one concrete concept per item — mechanism, definition term, cause→effect link, contrast, or example.
5) ELABORATE STEMS: Write clear, specific stems. Use the explanation to justify the answer briefly.
6) COVERAGE: Spread questions across separated ideas instead of staying on one sentence.
7) MCQ CHOICES: Every MCQ must have exactly four plausible choices and one clearly correct answer grounded in the excerpt.
8) JSON: Double-quoted keys and strings. No trailing commas. Stop after the closing ].${avoid}${broken}`;
}

/** Generate a balanced batch from the learner's own highlights/notes only. */
export async function generatePersonalQuizFromNotes(
  learnerNotes: string,
  count: number,
  opts?: { existingCounts?: PersonalQuizTypeCounts }
): Promise<CourseQuizItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const corpus = learnerNotes.trim().slice(0, MAX_CONTEXT_CHARS);
  if (corpus.length < 20) {
    throw new Error("Add a bit more text — paste a highlight or note first.");
  }

  const plan = planPersonalQuizTypes(count, opts?.existingCounts);
  const wanted = typeCounts(plan);
  // One backup of each type lets dedupe discard overlap without changing the mix.
  const prompt = generationPrompt({
    corpus,
    mcq: wanted.mcq + 1,
    freeResponse: wanted.freeResponse + 1,
  });

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  const model = tutorChatModel();

  const msg = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.42,
    messages: [{ role: "user", content: prompt }],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Could not build questions from that note.");
  }

  let parsed = parsePersonalQuizModelText(block.text);
  let selected = selectPersonalQuizItems(parsed, plan);
  const missing = missingTypes(selected, plan);
  if (missing.mcq > 0 || missing.freeResponse > 0) {
    const repairMcq = missing.mcq > 0 ? missing.mcq + 1 : 0;
    const repairFreeResponse =
      missing.freeResponse > 0 ? missing.freeResponse + 1 : 0;
    const repair = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: generationPrompt({
            corpus,
            mcq: repairMcq,
            freeResponse: repairFreeResponse,
            avoidQuestions: selected.map((item) => item.question),
            brokenOutput: block.text,
          }),
        },
      ],
    });
    const repaired = repair.content.find((b) => b.type === "text");
    if (repaired && repaired.type === "text") {
      parsed = [
        ...parsed,
        ...parsePersonalQuizModelText(repaired.text),
      ];
      selected = selectPersonalQuizItems(parsed, plan);
    }
  }

  if (selected.length !== plan.length) {
    console.error(
      "[personal-quiz-from-notes] could not satisfy balanced type plan",
      {
        wanted,
        selected: typeCounts(
          selected.map((item) =>
            isQuizFreeResponse(item) ? "free_response" : "mcq"
          )
        ),
        output: block.text.slice(0, 400),
      }
    );
    throw new Error(
      "Could not build a balanced question set from that note. Try a slightly longer selection."
    );
  }

  return selected;
}
