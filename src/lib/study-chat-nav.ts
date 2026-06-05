import type { CoursePayload } from "@/types/course";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "me",
  "my",
  "of",
  "on",
  "in",
  "for",
  "and",
  "or",
  "is",
  "are",
  "can",
  "you",
  "u",
  "please",
  "about",
  "where",
  "which",
  "what",
  "module",
  "modules",
  "lesson",
  "lessons",
  "section",
  "take",
  "go",
  "jump",
  "send",
  "bring",
  "show",
  "find",
  "search",
  "navigate",
  "cover",
  "covers",
  "covered",
  "talk",
  "talks",
  "has",
  "have",
]);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pull the topic out of "take me to …" / "where is …" style messages. */
export function extractNavigationQuery(text: string): string {
  let t = text.trim();
  const prefixes = [
    /^(?:can you|could you|would you|will you|please)\s+/i,
    /^(?:take me to|go to|jump to|send me to|bring me to|navigate to|show me)\s+(?:the\s+)?/i,
    /^(?:where is|where's|where are|which module (?:is|covers|has|talks about)|what module (?:is|covers|has|talks about))\s+(?:the\s+)?/i,
    /^(?:find|search for)\s+(?:the\s+)?/i,
  ];
  for (const p of prefixes) {
    t = t.replace(p, "").trim();
  }
  return t.replace(/[?.!]+$/, "").trim();
}

function queryTerms(query: string): string[] {
  return norm(query)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** 0–100 relevance of `text` to `query` (supports partial / multi-word queries). */
export function scoreTextMatch(query: string, text: string): number {
  const q = norm(query);
  const h = norm(text);
  if (!q || !h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 95;
  if (h.includes(q)) return 90;

  const terms = queryTerms(q);
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    if (h.includes(term)) score += 100 / terms.length;
  }
  return Math.round(score);
}

export type ModuleMatch = {
  materialId: string;
  moduleId: number;
  moduleTitle: string;
  reason: string;
  score: number;
};

function collectModuleMatches(
  payload: CoursePayload,
  materialId: string,
  queryRaw: string
): ModuleMatch[] {
  const query = extractNavigationQuery(queryRaw);
  if (!query) return [];

  const hits: ModuleMatch[] = [];

  for (const mod of payload.modules) {
    let best = 0;
    let reason = "";

    const titleScore = scoreTextMatch(query, mod.title);
    if (titleScore > best) {
      best = titleScore + 10;
      reason = `Module title: “${mod.title}”`;
    }

    for (const lesson of mod.lessons) {
      const lessonScore = scoreTextMatch(query, lesson.title);
      if (lessonScore + 5 > best) {
        best = lessonScore + 5;
        reason = `Lesson: “${lesson.title}” in “${mod.title}”`;
      }
      for (const kt of lesson.key_terms ?? []) {
        const ktScore = Math.max(
          scoreTextMatch(query, kt.term),
          scoreTextMatch(query, kt.definition) * 0.85
        );
        if (ktScore > best) {
          best = ktScore;
          reason = `Key term “${kt.term}” in “${mod.title}”`;
        }
      }
      const contentScore = scoreTextMatch(query, lesson.content ?? "") * 0.6;
      if (contentScore > best) {
        best = contentScore;
        reason = `Mentioned in “${lesson.title}” (${mod.title})`;
      }
    }

    if (best >= 35) {
      hits.push({
        materialId,
        moduleId: mod.id,
        moduleTitle: mod.title,
        reason,
        score: Math.round(best),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.moduleId - b.moduleId);
  return hits;
}

export function findModuleMatchesForQuery(
  payload: CoursePayload,
  materialId: string,
  queryRaw: string
): ModuleMatch[] {
  return collectModuleMatches(payload, materialId, queryRaw);
}

/**
 * Best-effort: find modules that mention `query` in title, lessons, or key terms.
 * Returns ranked matches (highest score first).
 */
export function findBestModuleIdForQuery(
  payload: CoursePayload,
  queryRaw: string
): { moduleId: number; reason: string } | null {
  const hits = collectModuleMatches(payload, "local", queryRaw);
  const top = hits[0];
  if (!top) return null;
  return { moduleId: top.moduleId, reason: top.reason };
}

export function findAllStudyLocationsForQuery(args: {
  materials: { id: string; course_payload: CoursePayload; label?: string }[];
  query: string;
}): ModuleMatch[] {
  const all: ModuleMatch[] = [];
  for (const m of args.materials) {
    all.push(...collectModuleMatches(m.course_payload, m.id, args.query));
  }
  all.sort((a, b) => b.score - a.score || a.materialId.localeCompare(b.materialId));
  return all;
}

/** @deprecated Use findAllStudyLocationsForQuery */
export function findBestStudyLocationForQuery(args: {
  materials: { id: string; course_payload: CoursePayload }[];
  query: string;
}): { materialId: string; moduleId: number; reason: string } | null {
  const hits = findAllStudyLocationsForQuery(args);
  const top = hits[0];
  if (!top) return null;
  return {
    materialId: top.materialId,
    moduleId: top.moduleId,
    reason: top.reason,
  };
}

/** True when the top match is clearly better than runners-up. */
export function isUnambiguousNavigation(
  matches: ModuleMatch[]
): ModuleMatch | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  const [top, second] = matches;
  if (top!.score - second!.score >= 15) return top!;
  if (top!.score >= 90 && second!.score < 70) return top!;
  return null;
}
