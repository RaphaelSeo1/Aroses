import type { LiveNotesStreamEvent } from "./marker-protocol.ts";

/**
 * Cheap deterministic repeat guard for live-note streams. Sits between the
 * marker parser (which emits one whole line per `text` event) and the client.
 *
 * A new bullet/paragraph is dropped when nearly all of its content words
 * already appear in ONE line of the existing notes (or a line written
 * earlier in this call) and it adds no new number. Corrections survive:
 * `@@revise` lines must be fully contained to drop, so a changed token keeps
 * them, and `@@delete` bodies (exact existing lines) are never filtered.
 * Headings are held until a line under them survives, so a restated section
 * never lands as an empty heading. The final canonical build still does the
 * real global merge; this only stops the obvious restatements.
 */

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
  "not", "but", "you", "our", "your", "just", "also", "more", "some", "any",
  "how", "why", "what", "when", "are", "was", "were", "been", "being", "its",
  "their", "they", "them", "these", "those", "which", "who", "whom", "can",
  "into", "onto", "than", "then", "there", "here", "each", "such", "very",
  "will", "would", "could", "should", "may", "might", "about", "over", "only",
  "one", "all", "both", "other", "like", "used", "use", "via", "per",
]);

/** Minimum content words before a line is eligible to be dropped. */
const MIN_TOKENS = 5;
/** Share of the new line's content words that must already be in one line. */
const APPEND_CONTAINMENT = 0.8;
const REVISE_CONTAINMENT = 1;

type Fingerprint = { tokens: Set<string>; numbers: Set<string> };

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("es") && /(?:ss|sh|ch|x)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function isHeading(line: string): boolean {
  return /^\s*#{1,6}\s/.test(line);
}

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

function isNested(line: string): boolean {
  return /^\s{2,}(?:[-*]|\d{1,2}\.)\s/.test(line);
}

function isTopLevelBullet(line: string): boolean {
  return /^(?:[-*]|\d{1,2}\.)\s/.test(line);
}

/** Lines that must always reach the student even if they echo notes. */
function isExempt(line: string): boolean {
  return /\*\*(?:open question|discrepancy)\b/i.test(line);
}

export function noteLineFingerprint(line: string): Fingerprint {
  const text = line
    .toLowerCase()
    .replace(/^\s*(?:[-*]|\d{1,2}\.|>\s*(?:\(ai\))?)\s*/, "")
    .replace(/\*\*|__|`/g, "");
  const numbers = new Set(text.match(/\d+(?:[.,]\d+)?/g) ?? []);
  const tokens = new Set<string>();
  for (const raw of text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (!raw || /^\d/.test(raw)) continue;
    if (raw.length < 3 || STOP.has(raw)) continue;
    tokens.add(stem(raw));
  }
  return { tokens, numbers };
}

/** True when `line` restates one of `prior` without adding a number or (enough) new words. */
export function isNearDuplicateNoteLine(
  line: string,
  prior: Fingerprint[],
  containment: number = APPEND_CONTAINMENT
): boolean {
  if (isHeading(line) || isTableLine(line) || isExempt(line)) return false;
  const next = noteLineFingerprint(line);
  if (next.tokens.size < MIN_TOKENS) return false;
  for (const p of prior) {
    let newNumber = false;
    for (const n of next.numbers) {
      if (!p.numbers.has(n)) {
        newNumber = true;
        break;
      }
    }
    if (newNumber) continue;
    let shared = 0;
    for (const t of next.tokens) if (p.tokens.has(t)) shared += 1;
    if (shared / next.tokens.size >= containment) return true;
  }
  return false;
}

function bodyFingerprints(markdown: string): Fingerprint[] {
  const out: Fingerprint[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.trim() || isHeading(line) || isTableLine(line)) continue;
    const fp = noteLineFingerprint(line);
    if (fp.tokens.size > 0) out.push(fp);
  }
  return out;
}

export type NoteLineGuard = {
  /** Filter parser events. `text` events must each be one whole line. */
  push: (events: LiveNotesStreamEvent[]) => LiveNotesStreamEvent[];
  /** End of stream: discards headings that never got a surviving line. */
  flush: () => LiveNotesStreamEvent[];
  /** Number of restated lines dropped so far. */
  dropped: () => number;
};

export function createNoteLineGuard(existingMarkdown: string[]): NoteLineGuard {
  const prior: Fingerprint[] = existingMarkdown.flatMap(bodyFingerprints);
  let mode: "append" | "revise" | "delete" | null = null;
  /** Headings (and blank lines after them) waiting for a surviving line. */
  let held: string[] = [];
  /** A dropped top-level bullet, re-emitted if a new nested child survives. */
  let droppedParent: string | null = null;
  let droppedCount = 0;

  const text = (line: string): LiveNotesStreamEvent => ({
    type: "text",
    delta: `${line}\n`,
  });

  const release = (out: LiveNotesStreamEvent[]) => {
    for (const line of held) out.push(text(line));
    held = [];
  };

  const onLine = (line: string, out: LiveNotesStreamEvent[]) => {
    if (mode !== "append" && mode !== "revise") {
      out.push(text(line));
      return;
    }
    if (isHeading(line)) {
      held.push(line);
      droppedParent = null;
      return;
    }
    if (!line.trim()) {
      if (held.length > 0) held.push(line);
      else out.push(text(line));
      return;
    }
    const containment =
      mode === "revise" ? REVISE_CONTAINMENT : APPEND_CONTAINMENT;
    if (isNearDuplicateNoteLine(line, prior, containment)) {
      droppedCount += 1;
      if (isTopLevelBullet(line)) droppedParent = line;
      return;
    }
    release(out);
    if (isNested(line) && droppedParent) {
      out.push(text(droppedParent));
    }
    if (!isNested(line)) droppedParent = null;
    out.push(text(line));
    if (!isTableLine(line)) {
      const fp = noteLineFingerprint(line);
      if (fp.tokens.size > 0) prior.push(fp);
    }
  };

  return {
    push(events) {
      const out: LiveNotesStreamEvent[] = [];
      for (const ev of events) {
        if (ev.type === "op") {
          held = [];
          droppedParent = null;
          mode = ev.op;
          out.push(ev);
        } else if (ev.type === "text") {
          const body = ev.delta.endsWith("\n") ? ev.delta.slice(0, -1) : ev.delta;
          for (const line of body.split("\n")) onLine(line, out);
        } else {
          out.push(ev);
        }
      }
      return out;
    },
    flush() {
      held = [];
      droppedParent = null;
      return [];
    },
    dropped: () => droppedCount,
  };
}
