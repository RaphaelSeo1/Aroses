/**
 * Review-chat notes linking: only when a reply cites student notes, and as an
 * inline "[your notes](url)" — never a separate "Open your notes" CTA.
 */

const NOTES_DOC_PATH_RE = /^\/notes\/doc\/[0-9a-f-]{36}$/i;

/** Already has an inline markdown link whose label mentions notes. */
const INLINE_NOTES_MD_LINK_RE =
  /\[[^\]]*\bnotes?\b[^\]]*\]\(\/notes\/doc\/[0-9a-f-]{36}\)/i;

/** First bare "your notes" not already inside a markdown link label. */
const BARE_YOUR_NOTES_RE = /(?<!\[)\byour notes\b(?!\])/i;

/** True when the assistant reply appears to cite or explain from the student's notes. */
export function replyCitesStudentNotes(reply: string): boolean {
  const text = reply.trim();
  if (!text) return false;
  if (/\[(?:open\s+)?your notes\]|\/notes\/doc\//i.test(text)) return true;
  if (/\byour notes say\b/i.test(text)) return true;
  if (/\baccording to your notes\b/i.test(text)) return true;
  if (/\bas (?:explained|written|shown) in your notes\b/i.test(text)) return true;
  // "in/from/per your notes" after stripping common "not … your notes" disclaimers.
  {
    const stripped = text.replace(
      /\bnot(?:\s+\w+){0,4}\s+(?:in|from)\s+your notes\b/gi,
      ""
    );
    if (/\b(?:in|from|per)\s+your notes\b/i.test(stripped)) return true;
  }
  // Blockquote + "notes" nearby — common quote-from-notes pattern.
  if (/^>\s+\S/m.test(text) && /\bnotes?\b/i.test(text)) return true;
  return false;
}

export function isReviewNotesDocPath(
  notesLink: string | null | undefined
): notesLink is string {
  return typeof notesLink === "string" && NOTES_DOC_PATH_RE.test(notesLink.trim());
}

/**
 * If the reply cites student notes but has no inline notes link yet, turn the
 * first "your notes" into [your notes](url). Leaves replies that don't cite
 * notes unchanged. Never injects a trailing "Open your notes" line.
 */
export function ensureInlineYourNotesLink(
  reply: string,
  notesLink: string | null | undefined,
  hadStudentNotes: boolean
): string {
  const link = typeof notesLink === "string" ? notesLink.trim() : "";
  if (!hadStudentNotes || !isReviewNotesDocPath(link)) return reply;
  if (!replyCitesStudentNotes(reply)) return reply;
  if (INLINE_NOTES_MD_LINK_RE.test(reply)) {
    // Normalize "Open your notes" labels to just "your notes".
    return reply.replace(
      /\[Open your notes\]\((\/notes\/doc\/[0-9a-f-]{36})\)/gi,
      "[your notes]($1)"
    );
  }

  if (BARE_YOUR_NOTES_RE.test(reply)) {
    return reply.replace(BARE_YOUR_NOTES_RE, `[your notes](${link})`);
  }

  // Cited via blockquote without the bare phrase — add a short inline clause
  // once at the end of the first paragraph.
  const md = `[your notes](${link})`;
  const paraBreak = reply.search(/\n\n/);
  if (paraBreak >= 0) {
    const head = reply.slice(0, paraBreak).trimEnd();
    const tail = reply.slice(paraBreak);
    const sep = /[.!?]$/.test(head) ? " " : ". ";
    return `${head}${sep}See ${md}.${tail}`;
  }
  const trimmed = reply.trimEnd();
  const sep = /[.!?]$/.test(trimmed) ? " " : ". ";
  return `${trimmed}${sep}See ${md}.`;
}
