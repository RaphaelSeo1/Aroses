import Anthropic from "@anthropic-ai/sdk";
import {
  normalizeQuizItemsLoose,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import { tutorChatModel } from "@/lib/ai/anthropic-models";
import type { CourseQuizItem, CourseQuizMcqItem } from "@/types/course";
import { isQuizMcq } from "@/types/course";

const QUIZ_ARRAY_KEYS = [
  "questions",
  "items",
  "quiz",
  "mcqs",
  "practice_questions",
] as const;

const MAX_CONTEXT_CHARS = 12_000;

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

/**
 * Drop MCQs whose stems target the same underlying fact as an earlier item
 * (paraphrases, “what is… / which best describes…”, same gist).
 */
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
  if (typeof o.type !== "string") o.type = "mcq";
  if (typeof o.explanation !== "string") o.explanation = "";
  return o;
}

/**
 * Generate MCQ-style practice items from the learner's own highlights/notes only.
 */
export async function generatePersonalQuizFromNotes(
  learnerNotes: string,
  count: number
): Promise<CourseQuizItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const corpus = learnerNotes.trim().slice(0, MAX_CONTEXT_CHARS);
  if (corpus.length < 20) {
    throw new Error("Add a bit more text — paste a highlight or note first.");
  }

  const targetOut = Math.min(12, Math.max(3, Math.floor(count)));
  /** Ask for a few extras so we can filter overlaps and still return `targetOut`. */
  const askCount = Math.min(8, targetOut + 2);

  const prompt = `You are writing practice quiz questions for ONE learner. Use ONLY the excerpts below — do not invent facts not grounded in this text.

LEARNER NOTES / HIGHLIGHTS:
${corpus}

Task: Output a JSON array of EXACTLY ${askCount} multiple-choice questions. Output ONLY the JSON array — no markdown fences, no commentary, no trailing text.
Each object: { "type": "mcq", "question": string, "choices": [4 strings], "correct": "A"|"B"|"C"|"D", "explanation": string }

Strict rules (follow all):
1) DISTINCT FACTS: Each question must test a different main idea from the notes. Do not ask the same underlying fact twice using different wording (e.g. avoid both “what is the purpose of X?” and “what does X help maintain?” if they have the same answer).
2) ONE PROBE PER QUESTION: Pick one concrete concept per item — mechanism, definition term, cause→effect link, contrast, or example — not a vague repeat of the theme.
3) ELABORATE STEMS: Write clear, specific stems (context in the question itself). Put teaching detail in the stem where helpful; use the explanation to justify the correct answer briefly.
4) COVERAGE: If the notes contain several separated ideas (e.g. blocks separated by "---"), spread questions across those ideas instead of staying on one sentence.
5) WRONG CHOICES: Distractors must be plausible but clearly wrong given the excerpt; avoid copying phrases from the stem verbatim into all choices.
6) JSON: Double-quoted keys and strings. No trailing commas. Stop after the closing ].

Quality over repetition — fewer strong, distinct questions beats many duplicates.`;

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
  if (parsed.length === 0) {
    const repair = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `You previously returned text that was not valid JSON. Output ONLY a JSON array of MCQ objects (no markdown, no commentary). Each object: { "type": "mcq", "question": string, "choices": [4 strings], "correct": "A"|"B"|"C"|"D", "explanation": string }

Broken output:
${block.text.slice(0, 12_000)}`,
        },
      ],
    });
    const repaired = repair.content.find((b) => b.type === "text");
    if (repaired && repaired.type === "text") {
      parsed = parsePersonalQuizModelText(repaired.text);
    }
  }

  if (parsed.length === 0) {
    console.error(
      "[personal-quiz-from-notes] unusable model JSON",
      block.text.slice(0, 400)
    );
    throw new Error("Could not build questions from that note. Try a slightly longer selection.");
  }

  const normalized = normalizeQuizItemsLoose(parsed.map(softenQuizItem));
  const mcqs = normalized.filter(isQuizMcq);
  const distinct = dedupePersonalMcqs(mcqs);
  return distinct.slice(0, targetOut);
}
