/**
 * Pulls a single teaching SVG out of a model reply and strips anything
 * that could run code or load a remote resource. CSS animation stays.
 */

const MAX_SVG_CHARS = 80_000;

export function sanitizeBoardSvg(raw: string): string | null {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  let svg = raw.slice(start, end + "</svg>".length).trim();
  if (svg.length < 40 || svg.length > MAX_SVG_CHARS) return null;

  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*\/?>/gi, "")
    .replace(/<image\b[^>]*\/?>/gi, "")
    .replace(/<use\b[^>]*\/?>/gi, "")
    .replace(/<link\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]*\/?>/gi, "");

  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  svg = svg.replace(
    /\s(?:href|xlink:href)\s*=\s*("|')(?!#)[^"']*\1/gi,
    ""
  );
  svg = svg.replace(/url\(\s*["']?(?!#)[^)"']*["']?\s*\)/gi, "none");
  svg = svg.replace(/javascript\s*:/gi, "");

  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) return null;
  if (/<(script|foreignObject|iframe|object|embed|image|use)\b/i.test(svg)) {
    return null;
  }
  return svg;
}

export function boardSvgPrompt(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): string {
  const labels = input.labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length >= 1 && label.length <= 32)
    .slice(0, 8);
  const motion = input.motion?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "";
  const labelRule =
    labels.length > 0
      ? `These labels may appear, spelled exactly, each at most once: ${labels
          .map((label) => `"${label}"`)
          .join(", ")}.`
      : "There is no required label list.";
  const motionRule = motion
    ? `This part keeps moving in a slow loop after it appears: ${motion}`
    : "If the description is a process, show that process moving in a slow loop. If it is a static structure, draw each part on, then hold.";
  return `Write one SVG motion graphic that teaches this idea, in the style of a premium flat product animation.
Dark board background #140c10. Flat shapes only, in rose #e11d48, gold #f5c16c, and soft white. No photographs, no characters, no app window, no speech bubbles, no paragraphs.
Return ONLY an <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">...</svg> document.
Put a <style> block in the svg with @keyframes. Important parts fade or draw in over the first few seconds (animation-fill-mode: both).
Every word is a <text> element, fully inside the viewBox, in a plain sans-serif. Spell it exactly. Do not add a title heading.
${labelRule}
You may also label an object with 1-4 words copied from the description, each label at most once. Do not invent a word the description did not use.
No script, no foreignObject, no image, no external URL, no event handler.

The idea (do not print this sentence): ${input.title.trim().slice(0, 120)}
Draw this, and only this: ${input.brief.trim().slice(0, 700)}
${motionRule}`;
}

/** Wraps a sanitized SVG so the browser can play its CSS animation. */
export function boardSvgDocument(svg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#140c10}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
}
