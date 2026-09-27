/**
 * Deterministic fixes applied to every piece of generated text. They enforce
 * content rules the model sometimes slips on, without another AI call.
 */

/** Splits text into runs that may be edited and runs (math, code) that may not. */
function mapOutsideMathAndCode(text: string, fn: (s: string) => string): string {
  const protectedRe = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|```[\s\S]*?```|`[^`\n]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(protectedRe)) {
    out += fn(text.slice(last, m.index));
    out += m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** 1-4 → 1–4, but not dates (2024-09-26), codes (10-K) or chains (1-2-3). */
export function enDashRanges(text: string): string {
  return mapOutsideMathAndCode(text, (s) =>
    s.replace(/(?<![\w.\-–/])(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?![\w\-–/]|\.\d)/g, "$1–$2")
  );
}

export function stripStrikethrough(text: string): string {
  return text.replace(/~~[^~\n]*~~\s?/g, "");
}

const OPENER = /^(in this (lesson|module|section|part)|this (lesson|module|section) (will|covers|explores|introduces)|let'?s (begin|start|explore|look))[^.!?\n]*[.!?]\s*/i;
const CLOSER = /^(in summary|to summarize|in conclusion|to conclude|overall, this (lesson|module))\b/i;

/** Drops a filler opening sentence and a closing recap paragraph. */
export function stripFiller(text: string): string {
  let t = text.trim().replace(OPENER, "");
  const paras = t.split(/\n{2,}/);
  if (paras.length > 1 && CLOSER.test(paras[paras.length - 1].trim())) paras.pop();
  t = paras.join("\n\n");
  return t.trim();
}

export function fixLessonText(text: string): string {
  return stripFiller(enDashRanges(stripStrikethrough(text)));
}

export function fixShortText(text: string): string {
  return enDashRanges(stripStrikethrough(text)).replace(/\s+/g, " ").trim();
}
