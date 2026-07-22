/**
 * Pull lesson `content` string values out of a partial module-JSON assistant
 * stream so the open lesson can update while the model is still generating.
 */

function readJsonString(
  s: string,
  start: number
): { value: string; complete: boolean; end: number } {
  let i = start;
  let value = "";
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      if (i + 1 >= s.length) return { value, complete: false, end: i };
      const n = s[i + 1];
      if (n === "n") value += "\n";
      else if (n === "t") value += "\t";
      else if (n === "r") value += "\r";
      else if (n === '"') value += '"';
      else if (n === "\\") value += "\\";
      else if (n === "/" ) value += "/";
      else if (n === "u" && i + 5 < s.length) {
        const hex = s.slice(i + 2, i + 6);
        const code = Number.parseInt(hex, 16);
        value += Number.isFinite(code) ? String.fromCharCode(code) : "";
        i += 6;
        continue;
      } else {
        value += n;
      }
      i += 2;
      continue;
    }
    if (c === '"') return { value, complete: true, end: i + 1 };
    value += c;
    i += 1;
  }
  return { value, complete: false, end: i };
}

export type StreamingLessonContent = {
  index: number;
  content: string;
  complete: boolean;
};

/**
 * Finds each `"content": "…"` field in order (lesson bodies in module JSON).
 * The last match may still be incomplete while tokens are arriving.
 */
export function extractStreamingLessonContents(
  partialAssistantText: string
): StreamingLessonContent[] {
  const text = partialAssistantText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const out: StreamingLessonContent[] = [];
  const re = /"content"\s*:\s*"/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const { value, complete, end } = readJsonString(text, start);
    out.push({ index, content: value, complete });
    index += 1;
    if (!complete) break;
    re.lastIndex = end;
  }
  return out;
}
