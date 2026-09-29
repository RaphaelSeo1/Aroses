/**
 * Server-side history trim for long Rose conversations.
 *
 * Up to `maxMessages`, history goes to the model verbatim: with prompt
 * caching it's read back at 0.1× input, so shortening it saves little and
 * any change to it forces a full cache rewrite. Past the cap the newest
 * `keepRecent`+ messages stay verbatim, the ones before them are condensed
 * (each cut to its opening, marked "[…]"), and the oldest are dropped. Both
 * boundaries move together in steps of `block` messages, so the prefix stays
 * byte-identical for several turns and keeps hitting the cache, where a plain
 * `slice(-max)` would shift, and miss, every turn.
 */

export type HistoryTrimOptions = {
  keepRecent?: number;
  block?: number;
  maxMessages?: number;
  userChars?: number;
  assistantChars?: number;
};

export const HISTORY_KEEP_RECENT = 12;
export const HISTORY_BLOCK = 8;
export const HISTORY_MAX_MESSAGES = 40;
const USER_CHARS = 400;
const ASSISTANT_CHARS = 600;

export function condenseMessage(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return text;
  const head = t.slice(0, limit);
  const space = head.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? head.slice(0, space) : head).trimEnd()} […]`;
}

export function trimChatHistory<T extends { role: "user" | "assistant"; content: string }>(
  messages: T[],
  opts: HistoryTrimOptions = {}
): T[] {
  const keep = Math.max(1, opts.keepRecent ?? HISTORY_KEEP_RECENT);
  const block = Math.max(1, opts.block ?? HISTORY_BLOCK);
  const max = Math.max(keep + block, opts.maxMessages ?? HISTORY_MAX_MESSAGES);
  const n = messages.length;
  if (n <= max) return messages;

  const cut = Math.floor((n - keep) / block) * block;
  // Condensed span is a fixed, even length, so the window stays within `max`
  // and keeps its user/assistant alignment.
  const start = cut - (Math.max(0, max - keep - block) & ~1);

  const userChars = opts.userChars ?? USER_CHARS;
  const assistantChars = opts.assistantChars ?? ASSISTANT_CHARS;
  return messages.slice(start).map((m, i) =>
    start + i < cut
      ? {
          ...m,
          content: condenseMessage(
            m.content,
            m.role === "user" ? userChars : assistantChars
          ),
        }
      : m
  );
}
