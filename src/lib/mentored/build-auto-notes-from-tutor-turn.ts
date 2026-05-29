import type { AutoGenerateBlock } from "@/components/immersive/NotesPanel";

function firstSentence(text: string, max = 72): string {
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
    .filter((s) => s.length > 20 && s.length < 280)
    .slice(0, max);
}

function parseBullet(text: string): { text: string; bold?: string } {
  const labeled = text.match(/^([^:—–]{2,48})\s*[—–:]\s*(.+)$/);
  if (labeled) {
    return { bold: labeled[1].trim(), text: text.trim() };
  }
  const termLead = text.match(/^([A-Z][A-Za-z0-9\- ]{1,40})\s+(?:is|are|means|refers to|describes)\b/i);
  if (termLead) {
    return { bold: termLead[1].trim(), text: text.trim() };
  }
  return { text: text.trim() };
}

/**
 * Heuristic fallback when Rose didn't emit structured `notesAppend`
 * meta but auto-generate is on. Turns a spoken tutor reply into study
 * notes — never pastes the full reply verbatim.
 */
export function buildAutoNotesFromTutorTurn(
  assistantText: string,
  opts?: { headingHint?: string }
): AutoGenerateBlock | null {
  const trimmed = assistantText.trim();
  if (trimmed.length < 40) return null;

  const heading =
    opts?.headingHint?.trim() ||
    firstSentence(trimmed, 64).replace(/[.!?]$/, "") ||
    "Session notes";

  const rawBullets = sentencesAsBullets(trimmed, 5);
  if (rawBullets.length === 0) return null;

  const bullets = rawBullets.map((line) => parseBullet(line));
  const intro =
    bullets.length === 1 && trimmed.length > rawBullets[0].length + 20
      ? firstSentence(trimmed, 160)
      : undefined;

  return {
    heading,
    intro,
    bullets,
  };
}

/** Detect when the student explicitly wants Rose to save to notes. */
export function studentRequestedNotesSave(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  if (t.length < 8) return false;
  return (
    /\b(add|put|save|include|write|append)\b/.test(t) &&
    /\b(notes|my notes|note doc|notebook)\b/.test(t)
  ) ||
    /\bkey concepts?\b/.test(t) && /\b(notes|my notes)\b/.test(t) ||
    /\bcan you add (this|these|that|it)\b/.test(t);
}
