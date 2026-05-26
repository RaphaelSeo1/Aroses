import type { AutoGenerateBlock } from "@/components/immersive/NotesPanel";
import type { KeyTerm } from "@/types/course";
import type { MentoredLessonChunk } from "@/types/mentored";

function firstSentence(text: string, max = 160): string {
  const t = text.trim();
  if (!t) return "";
  const m = t.match(/^(.+?[.!?])(?:\s|$)/);
  const s = (m ? m[1] : t).trim();
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function sentencesAsBullets(text: string, max = 3): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24)
    .slice(0, max);
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
  return { text: text.trim() };
}

/**
 * Turn a taught chunk into structured study notes — headings, key
 * concept bullets, vocabulary, and an optional analogy callout.
 * Avoids pasting the spoken explanation verbatim.
 */
export function buildAutoNotesFromChunk(
  chunk: MentoredLessonChunk,
  courseKeyTerms: KeyTerm[] = []
): AutoGenerateBlock | null {
  const vocabTerms = chunk.keyTerms ?? [];
  const termLookup = new Map(
    courseKeyTerms.map((kt) => [kt.term.toLowerCase(), kt])
  );

  const vocabulary = vocabTerms
    .map((term) => {
      const kt = termLookup.get(term.toLowerCase());
      return { term, definition: kt?.definition };
    })
    .filter((v) => v.term.length > 0);

  const boldCandidates = [
    ...vocabTerms,
    ...chunk.keyPoints
      .map((p) => p.split(/[—–:.]/)[0]?.trim() ?? "")
      .filter(Boolean),
  ];

  let bullets: AutoGenerateBlock["bullets"];
  if (chunk.keyPoints.length > 0) {
    bullets = chunk.keyPoints.slice(0, 5).map((kp) => {
      const parsed = parseBullet(kp);
      const bold = parsed.bold ?? matchBoldPrefix(parsed.text, boldCandidates);
      return bold ? { text: parsed.text, bold } : parsed.text;
    });
  } else {
    const fallback = sentencesAsBullets(chunk.explanation, 3);
    const lines =
      fallback.length > 0
        ? fallback
        : sentencesAsBullets(chunk.referenceAnswer, 3);
    bullets = lines.map((line) => {
      const bold = matchBoldPrefix(line, boldCandidates);
      return bold ? { text: line, bold } : line;
    });
  }

  if (bullets.length === 0) return null;

  let intro: string | undefined;
  if (bullets.length === 1 && chunk.explanation.trim()) {
    const summary = firstSentence(chunk.explanation);
    const only =
      typeof bullets[0] === "string" ? bullets[0] : bullets[0].text;
    if (
      summary &&
      summary.toLowerCase() !== only.toLowerCase() &&
      !only.toLowerCase().includes(summary.toLowerCase().slice(0, 40))
    ) {
      intro = summary;
    }
  }

  return {
    heading: chunk.concept,
    intro,
    bullets,
    vocabulary: vocabulary.length > 0 ? vocabulary : undefined,
    callout:
      chunk.analogy && chunk.analogy.trim().length > 0
        ? { emoji: "💡", text: chunk.analogy.trim() }
        : undefined,
  };
}
