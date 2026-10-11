import Anthropic from "@anthropic-ai/sdk";
import { tutorChatModel } from "@/lib/ai/anthropic-models";
import { boardSvgPrompt, sanitizeBoardSvg } from "@/lib/mentored/board-svg";

const cache = new Map<string, string>();
const CACHE_MAX = 24;

function cacheSet(key: string, value: string) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/**
 * Claude writes one motion-graphic SVG for the concept being taught.
 * The browser plays the CSS animation. Labels are real text, not painted pixels.
 */
export async function generateBoardSvg(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const key = boardSvgPrompt(input);
  const hit = cache.get(key);
  if (hit) return hit;

  const user = key;

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: tutorChatModel(),
    max_tokens: 8000,
    temperature: 0.4,
    messages: [{ role: "user", content: user }],
  });
  const block = msg.content.find((part) => part.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude did not return a drawing.");
  }
  const svg = sanitizeBoardSvg(block.text);
  if (!svg) throw new Error("Claude did not return a usable drawing.");
  cacheSet(key, svg);
  return svg;
}
