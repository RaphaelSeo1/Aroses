import type Anthropic from "@anthropic-ai/sdk";

type MessageParam = Anthropic.MessageParam;
type TextBlockParam = Anthropic.TextBlockParam;
type Usage = Anthropic.Usage;

/**
 * Anthropic prompt caching for the Rose chat paths.
 *
 * Cache order is tools → system → messages, and a breakpoint caches the whole
 * prefix up to it, so each prompt puts what never changes first (instructions,
 * course/lesson context) and marks its end. The conversation gets a second
 * breakpoint on its newest message: the next turn re-sends the same history
 * and reads it from cache. Prefixes shorter than the model minimum (1,024
 * tokens on Sonnet 4.6, 4,096 on Haiku 4.5) simply aren't cached — no error,
 * no write charge. Reads bill at 0.1× input, writes at 1.25× (5-minute TTL).
 */

export const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * System blocks: `stable` is cached; `rest` (per-turn or rarely changing
 * text) follows the breakpoint. Blocks are read in order, so the model sees
 * `stable + rest`.
 */
export function cachedSystem(stable: string, rest?: string | null): TextBlockParam[] {
  const blocks: TextBlockParam[] = [
    { type: "text", text: stable, cache_control: EPHEMERAL },
  ];
  if (rest) blocks.push({ type: "text", text: rest });
  return blocks;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

/** Messages with a cache breakpoint on the newest one. */
export function withCachedTail(messages: ChatMessage[]): MessageParam[] {
  return messages.map((m, i) =>
    i === messages.length - 1 && m.content
      ? {
          role: m.role,
          content: [{ type: "text", text: m.content, cache_control: EPHEMERAL }],
        }
      : { role: m.role, content: m.content }
  );
}

export type ChatUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function usageTokens(usage: Partial<Usage> | null | undefined): ChatUsageTokens {
  const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);
  return {
    inputTokens: n(usage?.input_tokens),
    outputTokens: n(usage?.output_tokens),
    cacheReadTokens: n(usage?.cache_read_input_tokens),
    cacheWriteTokens: n(usage?.cache_creation_input_tokens),
  };
}
