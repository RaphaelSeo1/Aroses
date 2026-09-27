import type { CourseBuildConfig } from "./config.ts";

/** USD per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

const PRICES: Array<[prefix: string, price: ModelPrice]> = [
  ["claude-haiku-4-5", { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
  ["claude-sonnet-4-6", { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  ["claude-sonnet-4-5", { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
];

/** Null for models we cannot price; callers must refuse those. */
export function modelPrice(model: string): ModelPrice | null {
  const id = model.trim();
  for (const [prefix, price] of PRICES) {
    if (id === prefix || id.startsWith(`${prefix}-`)) return price;
  }
  return null;
}

/** Tool-use system prompt Anthropic adds when tools are sent (tool_choice any/tool). */
const TOOL_SYSTEM_OVERHEAD_TOKENS = 600;
const MESSAGE_OVERHEAD_TOKENS = 16;
/** Anthropic image cost is about (w*h)/750 tokens, capped near 1,600 for a resized image. */
const IMAGE_TOKENS = 1_600;

/**
 * Over-estimates input tokens without a network call. ASCII text is counted
 * at 3 chars/token (real English is ~4); every non-ASCII character (Korean,
 * math symbols) counts as one token, which is at or above the real rate.
 */
export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3) + other;
}

type ContentLike = unknown;

function contentTokens(content: ContentLike): number {
  if (typeof content === "string") return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "image" || b.type === "document") total += IMAGE_TOKENS;
    else if (typeof b.text === "string") total += estimateTextTokens(b.text);
    else total += estimateTextTokens(JSON.stringify(block));
  }
  return total;
}

export type EstimatableRequest = {
  system?: ContentLike;
  messages: Array<{ role: string; content: ContentLike }>;
  tools?: unknown[];
};

export function estimateInputTokens(req: EstimatableRequest): number {
  let total = contentTokens(req.system);
  for (const m of req.messages) total += MESSAGE_OVERHEAD_TOKENS + contentTokens(m.content);
  if (req.tools && req.tools.length > 0) {
    total += TOOL_SYSTEM_OVERHEAD_TOKENS + estimateTextTokens(JSON.stringify(req.tools));
  }
  return total;
}

export function worstCaseCostUsd(price: ModelPrice, inputTokens: number, maxOutputTokens: number): number {
  return roundUsd((inputTokens * price.input + maxOutputTokens * price.output) / 1_000_000);
}

export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function actualCostUsd(price: ModelPrice, usage: UsageLike): number {
  const n = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
  return roundUsd(
    (n(usage.input_tokens) * price.input +
      n(usage.output_tokens) * price.output +
      n(usage.cache_creation_input_tokens) * price.cacheWrite +
      n(usage.cache_read_input_tokens) * price.cacheRead) /
      1_000_000
  );
}

/** Ledger precision is 8 decimals; round up so estimates never under-count. */
export function roundUsd(v: number): number {
  if (!(v > 0)) return 0;
  return Math.ceil(v * 1e8 - 1e-6) / 1e8;
}

/** Per-build hard ceiling: pages × per-page cap, never below the floor. */
export function buildSpendCapUsd(sourcePages: number, cfg: CourseBuildConfig): number {
  const pages = Number.isFinite(sourcePages) && sourcePages > 0 ? sourcePages : 0;
  return Math.max(cfg.minCapUsd, Math.round(pages * cfg.capUsdPerPage * 1e6) / 1e6);
}

/**
 * Rolling 24-hour AI spend ceiling for a user. Every tier gets the default
 * until plans are rebuilt around measured per-course cost.
 */
export function dailyCapUsdForTier(_tier: string | null | undefined, cfg: CourseBuildConfig): number {
  return cfg.defaultDailyCapUsd;
}
