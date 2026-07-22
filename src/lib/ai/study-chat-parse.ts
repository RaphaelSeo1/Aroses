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
      return stripStudyChatEmojis(parsed.reply.trim());
    }
    return "";
  }
  return stripStudyChatEmojis(s);
}

/** Ask Rose replies should stay professional — strip model-generated emoji. */
function stripStudyChatEmojis(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\u200D/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n[ \t]+/g, "\n")
    .trim();
}

export function parseStudyChatResponse(raw: string): {
  reply: string;
  action: unknown | null;
} {
  const trimmed = stripJsonFence(raw.trim());
  if (!trimmed) return { reply: "", action: null };

  // 1) Clean JSON object — the expected happy path.
  const direct = tryParseObject(trimmed);
  if (direct && typeof direct.reply === "string" && direct.reply.trim()) {
    return {
      reply: sanitizeStudyChatReply(direct.reply.trim()),
      action: direct.action ?? null,
    };
  }

  // 2) JSON wrapped in stray prose. Extract the first balanced-brace block
  //    (same tolerant approach used in mentored.ts / course-quantitative-qa.ts).
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    const parsed = tryParseObject(slice);
    if (parsed && typeof parsed.reply === "string" && parsed.reply.trim()) {
      const before = trimmed.slice(0, start).trim();
      const reply = sanitizeStudyChatReply(parsed.reply.trim());
      const merged = before && before !== reply ? `${before}\n\n${reply}` : reply;
      return { reply: merged.trim(), action: parsed.action ?? null };
    }
    // JSON parsed but reply was empty/missing — keep any surrounding prose as
    // the answer rather than dropping everything.
    if (parsed) {
      const before = trimmed.slice(0, start).trim();
      const after = trimmed.slice(end + 1).trim();
      const prose = [before, after].filter(Boolean).join("\n\n").trim();
      if (prose) return { reply: prose, action: parsed.action ?? null };
    }
  }

  // 3) Plain free-text answer (the model ignored JSON entirely). Always show it.
  return { reply: sanitizeStudyChatReply(trimmed), action: null };
}
