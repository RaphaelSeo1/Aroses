import type { AutoGenerateBlock } from "@/components/immersive/NotesPanel";
import type { KeyTerm } from "@/types/course";
import type { MentoredLessonChunk } from "@/types/mentored";

function firstSentence(text: string, max = 200): string {
  const t = text.trim();
  if (!t) return "";
  const m = t.match(/^(.+?[.!?])(?:\s|$)/);
  const s = (m ? m[1] : t).trim();
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function sentencesAsBullets(text: string, max = 5): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 320)
    .slice(0, max);
}

function isBareTerm(phrase: string): boolean {
  const t = phrase.trim();
  if (t.length < 3) return true;
  if (/[—–:]/.test(t)) return false;
  if (t.length > 72) return false;
  const words = t.split(/\s+/);
  return words.length <= 5 && !/\b(is|are|means|shows|records|tracks)\b/i.test(t);
}

function matchBoldPrefix(text: string, terms: string[]): string | undefined {
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    if (!term) continue;
    if (text.toLowerCase().startsWith(term.toLowerCase())) {
      return text.slice(0, term.length);
    }
    const sep = text.match(
      new RegExp(`^(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[—–:\\-]`, "i")
    );
    if (sep) return sep[1];
  }
  return undefined;
}

function parseBullet(text: string): { text: string; bold?: string } {
  const labeled = text.match(/^([^:—–]{2,48})\s*[—–:]\s*(.+)$/);
  if (labeled) {
    return { bold: labeled[1].trim(), text: text.trim() };
  }
  const termLead = text.match(
    /^([A-Za-z][A-Za-z0-9'’\- ]{1,48})\s+(?:is|are|means|refers to|describes|shows|tracks|records)\b/i
  );
  if (termLead) {
    return { bold: termLead[1].trim(), text: text.trim() };
  }
  return { text: text.trim() };
}

function definitionFromContext(
  term: string,
  ...sources: string[]
): string | undefined {
  const lower = term.toLowerCase();
  for (const src of sources) {
    if (!src.trim()) continue;
    const sentences = src
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of sentences) {
      if (!s.toLowerCase().includes(lower)) continue;
      if (s.length >= term.length + 18) {
        return s.length > 220 ? `${s.slice(0, 217).trim()}…` : s;
      }
    }
  }
  return undefined;
}

function bulletFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function isDuplicateBullet(candidate: string, existing: string[]): boolean {
  const fp = bulletFingerprint(candidate);
  return existing.some(
    (e) =>
      fp === bulletFingerprint(e) ||
      e.toLowerCase().includes(fp.slice(0, 48)) ||
      fp.includes(bulletFingerprint(e).slice(0, 48))
  );
}

function toStyledBullet(
  line: string,
  boldCandidates: string[]
): AutoGenerateBlock["bullets"][number] {
  const parsed = parseBullet(line);
  const bold = parsed.bold ?? matchBoldPrefix(parsed.text, boldCandidates);
  return bold ? { text: parsed.text, bold } : parsed.text;
}

/**
 * Turn a taught chunk into structured study notes — explanation bullets,
 * a takeaway, and vocabulary only when we can attach a real definition.
 */
export function buildAutoNotesFromChunk(
  chunk: MentoredLessonChunk,
  courseKeyTerms: KeyTerm[] = []
): AutoGenerateBlock | null {
  const vocabTerms = chunk.keyTerms ?? [];
  const termLookup = new Map(
    courseKeyTerms.map((kt) => [kt.term.toLowerCase(), kt])
  );

  const boldCandidates = [
    ...vocabTerms,
    ...chunk.keyPoints
      .map((p) => p.split(/[—–:.]/)[0]?.trim() ?? "")
      .filter(Boolean),
  ];

  const seen: string[] = [];
  const bullets: AutoGenerateBlock["bullets"] = [];

  const addLine = (line: string) => {
    const t = line.trim();
    if (!t || isDuplicateBullet(t, seen)) return;
    seen.push(t);
    bullets.push(toStyledBullet(t, boldCandidates));
  };

  // Core notes: what Rose actually taught (not bare rubric keyPoints).
  for (const line of sentencesAsBullets(chunk.explanation, 5)) {
    addLine(line);
  }

  // Substantive key points only — skip naked terms like "balance sheet".
  for (const kp of chunk.keyPoints.slice(0, 5)) {
    if (isBareTerm(kp)) {
      const expanded = definitionFromContext(
        kp,
        chunk.explanation,
        chunk.referenceAnswer
      );
      if (expanded) addLine(expanded);
    } else {
      addLine(kp);
    }
  }

  // Strong-answer summary — the "so what" of the concept.
  const takeaway = firstSentence(chunk.referenceAnswer, 240);
  if (
    takeaway &&
    takeaway.length > 28 &&
    !isDuplicateBullet(takeaway, seen)
  ) {
    addLine(takeaway);
  }

  if (bullets.length === 0) return null;

  const intro = firstSentence(chunk.explanation, 200);

  const vocabulary = vocabTerms
    .map((term) => {
      const kt = termLookup.get(term.toLowerCase());
      const definition =
        kt?.definition?.trim() ||
        definitionFromContext(term, chunk.explanation, chunk.referenceAnswer);
      if (!definition) return null;
      const def =
        definition.length > 220
          ? `${definition.slice(0, 217).trim()}…`
          : definition;
      return { term, definition: def };
    })
    .filter((v): v is { term: string; definition: string } => v != null);

  const selfCheck =
    chunk.checkQuestion.trim().length > 12
      ? [chunk.checkQuestion.trim()]
      : undefined;

  return {
    heading: chunk.concept,
    intro: intro.length > 0 ? intro : undefined,
    bullets,
    vocabulary: vocabulary.length > 0 ? vocabulary : undefined,
    selfCheck,
    callout:
      chunk.analogy && chunk.analogy.trim().length > 0
        ? { emoji: "💡", text: chunk.analogy.trim() }
        : undefined,
  };
}
