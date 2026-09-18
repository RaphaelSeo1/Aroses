import { tokenizeNoteText } from "@/lib/live-notes/fold-note-markdown";

/**
 * Pure guards for the wrap-up factual review (kept out of the server-only
 * model module so they can be unit-tested).
 */

/**
 * Deck pages most relevant to a batch of note sections, in deck order, up to
 * `maxChars`. Replaces "first N chars of the deck", which hid every later
 * slide from the reviewer and made slide-drafted notes look unsupported.
 */
export function selectDeckExcerptFor(
  batchMarkdown: string,
  deckContent: string,
  maxChars: number
): string {
  if (!deckContent) return "";
  if (deckContent.length <= maxChars) return deckContent;
  const blocks = deckContent.split(/\n\n(?=\[slide \d+\])/);
  const batchTokens = new Set(tokenizeNoteText(batchMarkdown));
  const scored = blocks.map((block, index) => {
    const toks = tokenizeNoteText(block);
    let hit = 0;
    for (const t of toks) if (batchTokens.has(t)) hit += 1;
    return { block, index, score: toks.length ? hit / Math.sqrt(toks.length) : 0 };
  });
  const chosen = new Set<number>();
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (s.score <= 0) break;
    if (used + s.block.length + 2 > maxChars) continue;
    chosen.add(s.index);
    used += s.block.length + 2;
  }
  return scored
    .filter((s) => chosen.has(s.index))
    .map((s) => s.block)
    .join("\n\n");
}

/**
 * A "narrow factual fix" that drops a large share of the section's body
 * lines is an over-cut, not a fix. Body lines = non-heading, non-blank.
 */
export function isOverCutRevision(original: string, revised: string): boolean {
  const bodyLines = (md: string) =>
    md
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^#{1,3}\s/.test(l) && l !== "---");
  const before = bodyLines(original);
  const after = bodyLines(revised);
  if (before.length <= 2) return after.length === 0;
  const dropped = before.length - after.length;
  return dropped > Math.max(1, Math.floor(before.length * 0.2));
}
