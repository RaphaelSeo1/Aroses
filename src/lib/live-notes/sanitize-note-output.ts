/**
 * Deterministic cleanup of model note bodies before they are typed into the
 * document. Drops protocol echoes, placeholders, meta-commentary, empty
 * headings, and dangling colon bullets. Does not invent or rewrite facts.
 */

const PROTOCOL_LINE =
  /^(?:<[^>]*>|@@\S.*|.*\bfolded into\b.*|.*\bno new content\b.*|.*\bnothing to add\b.*)$/i;

const META_LINE =
  /\b(?:this section will be updated|no selectable text|minimal or no selectable|slides?\s+\d+|slide extraction|transcription|will be updated when|cannot extract|OCR failed|as more (?:audio|speech) arrives)\b/i;

const PLACEHOLDER_SNIPPET =
  /folded into\s*@@|or nothing when|leave the body empty|<nothing\b/i;

function isTerminalPunctuation(line: string): boolean {
  const t = line.trimEnd();
  if (!t) return true;
  if (/[.!?…"')\]]\s*$/.test(t)) return true;
  if (/\*\*[^*]+\*\*\s*$/.test(t)) return true;
  if (/\|/.test(t) && /\|\s*$/.test(t)) return true;
  if (/^#{1,3}\s/.test(t)) return true;
  if (/^>\s/.test(t)) return true;
  return false;
}

function isProtocolOrMeta(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (PROTOCOL_LINE.test(t)) return true;
  if (/^<[^>]+>$/.test(t)) return true;
  if (t.includes("@@")) return true;
  if (PLACEHOLDER_SNIPPET.test(t)) return true;
  if (META_LINE.test(t)) return true;
  return false;
}

function isHeadingOnly(line: string): boolean {
  return /^#{1,3}\s+\S/.test(line.trim());
}

function isDanglingColonBullet(line: string): boolean {
  const t = line.trim();
  return /^[-*]\s+.+:\s*$/.test(t) || /^\d+\.\s+.+:\s*$/.test(t);
}

/**
 * Sanitize a revise/append/delete body. When `dropTruncatedTrailing` is set
 * (stream aborted/errored), also drop a final line that looks mid-word cut off.
 */
export function sanitizeNoteOutput(
  markdown: string,
  opts?: { dropTruncatedTrailing?: boolean }
): string {
  const raw = markdown.replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";

  const lines = raw.split("\n");
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isProtocolOrMeta(line)) continue;

    if (isHeadingOnly(line)) {
      // Keep heading only when a non-empty body follows before the next H2/H3.
      let hasBody = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextRaw = lines[j]!;
        const next = nextRaw.trim();
        if (!next) continue;
        if (/^#{1,3}\s/.test(next)) break;
        if (isProtocolOrMeta(nextRaw)) continue;
        if (isDanglingColonBullet(nextRaw)) continue;
        hasBody = true;
        break;
      }
      if (!hasBody) continue;
    }

    if (isDanglingColonBullet(line)) {
      let hasChild = false;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!;
        if (!next.trim()) continue;
        if (/^#{1,3}\s/.test(next.trim())) break;
        if (/^[-*]\s/.test(next.trim()) && !/^\s{2,}[-*]/.test(next)) break;
        if (/^\s{2,}[-*]/.test(next) || /^\s{2,}\S/.test(next)) {
          hasChild = true;
          break;
        }
        break;
      }
      if (!hasChild) continue;
    }

    kept.push(line);
  }

  if (opts?.dropTruncatedTrailing && kept.length > 0) {
    const last = kept[kept.length - 1]!;
    const trimmed = last.trim();
    if (
      trimmed.length >= 12 &&
      !isTerminalPunctuation(trimmed) &&
      /[a-z]$/i.test(trimmed) &&
      !/^#{1,3}\s/.test(trimmed) &&
      !/^\|/.test(trimmed)
    ) {
      kept.pop();
    }
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
