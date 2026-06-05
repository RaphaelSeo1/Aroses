/** Robustly extract reply + action when the model disobeys "JSON only". */

function stripJsonFence(s: string): string {
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function tryParseObject(text: string): { reply?: unknown; action?: unknown } | null {
  try {
    const parsed = JSON.parse(text) as { reply?: unknown; action?: unknown };
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** Remove trailing accidental JSON blobs from user-visible text. */
export function sanitizeStudyChatReply(text: string): string {
  let s = text.trim();
  const jsonStart = s.search(/\{\s*"reply"\s*:/);
  if (jsonStart > 0) {
    s = s.slice(0, jsonStart).trim();
  }
  if (/^\{\s*"reply"\s*:/.test(s)) {
    const parsed = tryParseObject(s);
    if (parsed && typeof parsed.reply === "string") {
      return parsed.reply.trim();
    }
    return "";
  }
  return s;
}

export function parseStudyChatResponse(raw: string): {
  reply: string;
  action: unknown | null;
} {
  const trimmed = stripJsonFence(raw.trim());
  if (!trimmed) return { reply: "", action: null };

  const direct = tryParseObject(trimmed);
  if (direct && typeof direct.reply === "string") {
    return {
      reply: sanitizeStudyChatReply(direct.reply.trim()),
      action: direct.action ?? null,
    };
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*"reply"\s*:[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = tryParseObject(jsonMatch[0]);
    if (parsed && typeof parsed.reply === "string") {
      const before = trimmed.slice(0, jsonMatch.index ?? 0).trim();
      const reply = sanitizeStudyChatReply(parsed.reply.trim());
      const merged = before && before !== reply ? `${before}\n\n${reply}` : reply;
      return { reply: merged.trim(), action: parsed.action ?? null };
    }
  }

  return { reply: sanitizeStudyChatReply(trimmed), action: null };
}
