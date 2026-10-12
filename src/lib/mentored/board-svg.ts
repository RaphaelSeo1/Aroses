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

export function drawingBrief(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\|/g, " ")
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

/** Motion to animate, when the idea itself changes. Empty for a structure that holds still. */
export function motionForBoard(brief: string, motion?: string): string {
  const given = (motion ?? "").replace(/\s+/g, " ").trim();
  if (given.length >= 8) return given.slice(0, 300);
  if (
    /\b(flow|flows|move|moves|cycle|cycles|shift|shifts|pump|pumps|rotate|rotates|travel|travels|absorb|convert\w*|slides?|transfer\w*|binds?|releases?|enters?|leaves?|cross(?:es|ing)?|grows?|circulat\w*|oscillat\w*|diffus\w*|stage|stages|titrat\w*|added|adding|becomes|becoming|during|equilibrium|dissociat\w*|over time|hour|hours)\b/i.test(
      brief
    )
  ) {
    return "Move the object the description says is changing. Keep every object in the frame and loop that motion.";
  }
  return "";
}

export function boardSvgPrompt(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
  problems?: string[];
}): string {
  const labels = input.labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length >= 1 && label.length <= 24 && label.split(/\s+/).length <= 3)
    .slice(0, 4);
  const motion = motionForBoard(input.brief, input.motion);
  const labelRule =
    labels.length > 0
      ? `Optional part names, 1–3 words, only if they name a physical part of the drawing: ${labels
          .map((label) => `"${label}"`)
          .join(", ")}. Omit any of these that is a slogan or the lesson title.`
      : "Do not invent labels. A part may be unlabeled.";
  const motionRule = motion
    ? `Something in the picture keeps moving, and that moving thing is an object from the description, not a caption. Use @keyframes with transform (translate, rotate, or motion along a path). ${motion}`
    : "This is a structure. Draw each part, then hold. A short fade-in of the parts is enough.";
  const retry =
    input.problems && input.problems.length > 0
      ? `The previous drawing was rejected: ${input.problems.join("; ")}. Draw the objects again so a student can see the idea without reading a caption.`
      : "";
  return `Draw one teaching picture as SVG. The student must SEE the idea. A dark board with the concept written on it is a failure. Circles or rectangles whose only job is to hold that phrase are a failure.
Dark background #140c10. Flat solid shapes in rose #e11d48, gold #f5c16c, blue #7eb6ff, and soft white #fff7f4. Fills are solid (opacity 0.85 or more). No photographs, no faces, no app window, no speech bubbles, no paragraphs, no flowchart of text boxes.
Use <path>, <polygon>, <ellipse>, <circle>, <line>, and <rect> to draw the actual objects: atoms and electrons, a membrane and its proteins, a curve on axes, a cell, a molecule, a machine, a landscape, two contrasting situations, a marked scale. Match the description. Do not reuse a diagram of a different idea.
Return an <svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">...</svg> document and nothing else.
${motionRule}
Every object is visible at the first moment. Do not set opacity to 0. Do not fade the picture in. If something moves, it is already drawn and the motion is a transform.
Every word is a <text> element inside the viewBox, at most 2 words, placed on the part it names. Never print the lesson title, a panel heading, or a sentence.
${labelRule}
No script, no foreignObject, no image, no external URL, no event handler.
${retry}
Lesson title (do not letter this onto the board): ${input.title.trim().slice(0, 120)}
Draw this, and only this: ${drawingBrief(input.brief)}`;
}

export type TeachingSvgInput = {
  title: string;
  brief?: string;
  labels?: string[];
  motion?: string;
};

/** Why this SVG is not a teaching picture. Empty means it can go on the board. */
export function teachingSvgProblems(svg: string, input: TeachingSvgInput): string[] {
  const problems: string[] = [];
  if (!/<svg[\s>]/i.test(svg) || !/<\/svg>/i.test(svg)) {
    problems.push("no svg drawing");
    return problems;
  }

  const texts = svgText(svg);
  const title = input.title.replace(/\s+/g, " ").trim().toLowerCase();
  for (const node of texts) {
    const prose = proseWordCount(node);
    if (prose > 3) problems.push("a label is a sentence");
    else if (node.length > 48 || (!isFormula(node) && node.length > 24)) {
      problems.push("a label is too long to be part of the picture");
    }
    if (title.length > 8 && node.toLowerCase() === title) problems.push("the lesson title is the picture");
  }
  const joined = texts.join(" ").toLowerCase();
  if (title.length > 18 && joined.includes(title)) problems.push("the concept phrase is written on the board");

  const counts = drawableCounts(svg);
  const specific = counts.path + counts.polygon + counts.polyline + counts.ellipse;
  const drawable = specific + counts.circle + counts.line + counts.rect;
  if (drawable < 4) problems.push("not enough drawing");
  if (specific === 0 && drawable < 8) problems.push("generic shapes instead of the object");
  if (texts.join("").length > 80 && drawable < 10) problems.push("the board is mostly writing");

  const motion = motionForBoard(input.brief ?? "", input.motion);
  if (motion && !objectMotion(svg)) problems.push("the moving part does not actually move");
  if (pictureStartsHidden(svg)) problems.push("the picture starts invisible");
  return problems;
}

/** Drops sentence captions. Formulas and short part names stay on the drawing. */
export function withoutProseLabels(svg: string): string {
  return svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gi, (node) => {
    const shown = node
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (!shown) return "";
    if (proseWordCount(shown) > 3) return "";
    if (!isFormula(shown) && shown.length > 24) return "";
    return node;
  });
}

function proseWordCount(node: string): number {
  return node.split(/\s+/).filter((word) => /^[A-Za-z가-힣']{2,}$/.test(word)).length;
}

function isFormula(node: string): boolean {
  if (proseWordCount(node) > 2) return false;
  return /[=⇌↔→←±]/.test(node) || /[₀₁₂₃₄₅₆₇₈₉⁺⁻]/.test(node);
}

function svgText(svg: string): string[] {
  const nodes: string[] = [];
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)) {
    const text = match[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (text) nodes.push(text);
  }
  return nodes;
}

function drawableCounts(svg: string): Record<"path" | "polygon" | "polyline" | "ellipse" | "circle" | "line" | "rect", number> {
  const count = (tag: string) => svg.match(new RegExp(`<${tag}\\b`, "gi"))?.length ?? 0;
  const rects = [...svg.matchAll(/<rect\b([^>]*)\/?>/gi)].filter((match) => {
    const width = Number(match[1].match(/\bwidth="([\d.]+)"/)?.[1] ?? 0);
    const height = Number(match[1].match(/\bheight="([\d.]+)"/)?.[1] ?? 0);
    return !(width >= 800 && height >= 400);
  }).length;
  return {
    path: count("path"),
    polygon: count("polygon"),
    polyline: count("polyline"),
    ellipse: count("ellipse"),
    circle: count("circle"),
    line: count("line"),
    rect: rects,
  };
}

function pictureStartsHidden(svg: string): boolean {
  const style = svg.match(/<style[\s\S]*?<\/style>/gi)?.join("\n") ?? "";
  if (!style) return false;
  return (
    /@keyframes[\s\S]*?(?:from|0%)\s*\{[^}]*opacity\s*:\s*0/i.test(style) &&
    /\bboth\b/.test(style)
  );
}

function objectMotion(svg: string): boolean {
  if (/<animateMotion\b|<animateTransform\b/i.test(svg)) return true;
  if (/<animate\b[^>]*attributeName="(?:transform|cx|cy|x|y|d|points)"/i.test(svg)) return true;
  const style = svg.match(/<style[\s\S]*?<\/style>/i)?.[0] ?? "";
  return /@keyframes/i.test(style) && /transform|translate|rotate|scale|offset-distance|stroke-dashoffset/i.test(style);
}

/** Wraps a sanitized SVG so the browser can play its CSS animation. */
export function boardSvgDocument(svg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#140c10}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
}
