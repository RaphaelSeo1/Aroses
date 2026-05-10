import Anthropic from "@anthropic-ai/sdk";
import {
  normalizeQuizItemsLoose,
  stripJsonFence,
} from "@/lib/ai/course-payload";
import type { CourseQuizItem, CourseQuizMcqItem } from "@/types/course";
import { isQuizMcq } from "@/types/course";

const MODEL = "claude-sonnet-4-20250514";

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
  /** Ask for extras so we can filter overlaps and still return `targetOut` when possible. */
  const askCount = Math.min(14, targetOut + 5);

  const prompt = `You are writing practice quiz questions for ONE learner. Use ONLY the excerpts below — do not invent facts not grounded in this text.

LEARNER NOTES / HIGHLIGHTS:
${corpus}

Task: Output EXACTLY ${askCount} multiple-choice questions as a JSON array only (no markdown fences, no commentary).
Each object: { "type": "mcq", "question": string, "choices": [4 strings], "correct": "A"|"B"|"C"|"D" OR matching choice text, "explanation": string }

Strict rules (follow all):
1) DISTINCT FACTS: Each question must test a different main idea from the notes. Do not ask the same underlying fact twice using different wording (e.g. avoid both “what is the purpose of X?” and “what does X help maintain?” if they have the same answer).
2) ONE PROBE PER QUESTION: Pick one concrete concept per item — mechanism, definition term, cause→effect link, contrast, or example — not a vague repeat of the theme.
3) ELABORATE STEMS: Write clear, specific stems (context in the question itself). Put teaching detail in the stem where helpful; use the explanation to justify the correct answer briefly.
4) COVERAGE: If the notes contain several separated ideas (e.g. blocks separated by "---"), spread questions across those ideas instead of staying on one sentence.
5) WRONG CHOICES: Distractors must be plausible but clearly wrong given the excerpt; avoid copying phrases from the stem verbatim into all choices.

Quality over repetition — fewer strong, distinct questions beats many duplicates.`;

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0 });

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6144,
    temperature: 0.42,
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
    throw new Error("Expected a JSON array of questions");
  }

  const normalized = normalizeQuizItemsLoose(parsed);
  const mcqs = normalized.filter(isQuizMcq);
  const distinct = dedupePersonalMcqs(mcqs);
  return distinct.slice(0, targetOut);
}
