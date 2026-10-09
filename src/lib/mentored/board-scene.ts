import type { BoardMark, BoardMarkKind, BoardScene, BoardTone } from "@/types/mentored";

const KINDS = new Set<BoardMarkKind>([
  "band",
  "box",
  "circle",
  "arrow",
  "text",
  "wave",
  "dots",
]);

const TONES = new Set<BoardTone>(["rose", "gold", "blue", "ink", "muted"]);

const FILL: Record<BoardTone, string> = {
  rose: "#e11d48",
  gold: "#f5c542",
  blue: "#2563eb",
  ink: "#f4f4f5",
  muted: "#52525b",
};

const STROKE: Record<BoardTone, string> = {
  rose: "#fda4af",
  gold: "#fde68a",
  blue: "#93c5fd",
  ink: "#e4e4e7",
  muted: "#a1a1aa",
};

const INK: Record<BoardTone, string> = {
  rose: "#fff",
  gold: "#1c1917",
  blue: "#fff",
  ink: "#18181b",
  muted: "#e4e4e7",
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseBoardScene(raw: unknown): BoardScene | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.marks)) return undefined;
  const marks: BoardMark[] = [];
  for (const item of o.marks) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const kind = m.kind;
    if (typeof kind !== "string" || !KINDS.has(kind as BoardMarkKind)) continue;
    const text =
      typeof m.text === "string" ? m.text.trim().slice(0, 42) : undefined;
    const tone =
      typeof m.tone === "string" && TONES.has(m.tone as BoardTone)
        ? (m.tone as BoardTone)
        : undefined;
    marks.push({
      kind: kind as BoardMarkKind,
      x: clamp(num(m.x)),
      y: clamp(num(m.y)),
      w: m.w != null ? clamp(num(m.w), 1, 100) : undefined,
      h: m.h != null ? clamp(num(m.h), 1, 100) : undefined,
      r: m.r != null ? clamp(num(m.r), 0.5, 40) : undefined,
      x2: m.x2 != null ? clamp(num(m.x2)) : undefined,
      y2: m.y2 != null ? clamp(num(m.y2)) : undefined,
      text: text || undefined,
      tone,
    });
    if (marks.length >= 16) break;
  }
  if (marks.length === 0) return undefined;
  const kicker =
    typeof o.kicker === "string" ? o.kicker.trim().slice(0, 32) : undefined;
  const title =
    typeof o.title === "string" ? o.title.trim().slice(0, 80) : undefined;
  return {
    kicker: kicker || undefined,
    title: title || undefined,
    marks,
  };
}

function toneOf(mark: BoardMark): BoardTone {
  return mark.tone ?? "ink";
}

function markSvg(mark: BoardMark, i: number): string {
  const tone = toneOf(mark);
  const fill = FILL[tone];
  const stroke = STROKE[tone];
  const ink = INK[tone];
  const label = mark.text ? esc(mark.text) : "";
  if (mark.kind === "band" || mark.kind === "box") {
    const w = mark.w ?? (mark.kind === "band" ? 80 : 14);
    const h = mark.h ?? (mark.kind === "band" ? 8 : 18);
    const x = mark.x - w / 2;
    const y = mark.y - h / 2;
    const body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${mark.kind === "band" ? 1.2 : 2}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
    if (!label || mark.kind === "band") return body;
    return `${body}<text x="${mark.x}" y="${mark.y + 1.2}" text-anchor="middle" fill="${ink}" font-size="3.4" font-weight="700">${label}</text>`;
  }
  if (mark.kind === "circle") {
    const r = mark.r ?? 7;
    const body = `<circle cx="${mark.x}" cy="${mark.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
    if (!label) return body;
    return `${body}<text x="${mark.x}" y="${mark.y + 1.2}" text-anchor="middle" fill="${ink}" font-size="2.8" font-weight="700">${label}</text>`;
  }
  if (mark.kind === "arrow") {
    const x2 = mark.x2 ?? mark.x;
    const y2 = mark.y2 ?? mark.y;
    return `<line data-mark="arrow" x1="${mark.x}" y1="${mark.y}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="0.9" marker-end="url(#board-arrow)"/>`;
  }
  if (mark.kind === "text") {
    if (!label) return "";
    return `<text data-mark="text" x="${mark.x}" y="${mark.y}" text-anchor="middle" fill="${stroke}" font-size="3.2" font-weight="600">${label}</text>`;
  }
  if (mark.kind === "wave") {
    const w = mark.w ?? 40;
    const x = mark.x;
    const y = mark.y;
    const d = `M ${x} ${y} Q ${x + w * 0.25} ${y - 4} ${x + w * 0.5} ${y} T ${x + w} ${y}`;
    return `<path data-mark="wave" d="${d}" fill="none" stroke="${stroke}" stroke-width="1.1"/>`;
  }
  const w = mark.w ?? 16;
  const h = mark.h ?? 10;
  const dots: string[] = [];
  for (let n = 0; n < 6; n++) {
    const dx = ((n * 17) % 7) - 3;
    const dy = ((n * 11) % 5) - 2;
    dots.push(
      `<circle data-mark="dot" cx="${clamp(mark.x + (dx / 6) * w)}" cy="${clamp(mark.y + (dy / 4) * h)}" r="1.15" fill="${fill}"/>`
    );
  }
  return dots.join("");
}

/** SVG markup for a teaching-board scene. Text is escaped. */
export function boardSceneSvg(scene: BoardScene): string {
  const kicker = scene.kicker ? esc(scene.kicker) : "";
  const title = scene.title ? esc(scene.title) : "";
  const marks = scene.marks.map(markSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${title || kicker || "Lesson diagram"}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  <rect width="100" height="100" fill="#1a1216"/>
  <defs>
    <marker id="board-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
      <path d="M0,0 L4,2 L0,4 Z" fill="#fda4af"/>
    </marker>
  </defs>
  ${kicker ? `<text data-mark="kicker" x="6" y="7" fill="#fb7185" font-size="2.6" font-weight="700" letter-spacing="0.14">${kicker.toUpperCase()}</text>` : ""}
  ${title ? `<text data-mark="title" x="6" y="12.5" fill="#fafafa" font-size="3.6" font-weight="650">${title}</text>` : ""}
  ${marks}
</svg>`;
}

/** Chemiosmosis membrane: complexes, protons, ATP synthase. */
export const CHEMIOSMOSIS_SCENE: BoardScene = {
  kicker: "Whiteboard",
  title: "Protons power ATP synthase",
  marks: [
    { kind: "text", x: 50, y: 20, text: "Intermembrane space", tone: "muted" },
    { kind: "dots", x: 50, y: 28, w: 50, h: 8, tone: "ink" },
    { kind: "band", x: 50, y: 48, w: 88, h: 7, tone: "muted" },
    { kind: "box", x: 22, y: 48, w: 12, h: 22, text: "I", tone: "rose" },
    { kind: "box", x: 38, y: 48, w: 12, h: 22, text: "II", tone: "rose" },
    { kind: "box", x: 54, y: 48, w: 12, h: 22, text: "III", tone: "rose" },
    { kind: "box", x: 70, y: 48, w: 12, h: 22, text: "IV", tone: "rose" },
    { kind: "arrow", x: 22, y: 34, x2: 22, y2: 24, tone: "rose" },
    { kind: "circle", x: 88, y: 48, r: 8, text: "ATP", tone: "gold" },
    { kind: "text", x: 50, y: 78, text: "Matrix", tone: "muted" },
  ],
};

/** Dam analogy: water, dam, turbine. Distinct from the membrane scene. */
export const DAM_ANALOGY_SCENE: BoardScene = {
  kicker: "New analogy",
  title: "Protons are water behind a dam",
  marks: [
    { kind: "wave", x: 8, y: 36, w: 36, tone: "blue" },
    { kind: "dots", x: 24, y: 44, w: 28, h: 16, tone: "blue" },
    { kind: "box", x: 48, y: 50, w: 8, h: 42, text: "Dam", tone: "muted" },
    { kind: "text", x: 22, y: 24, text: "Water held back", tone: "blue" },
    { kind: "circle", x: 72, y: 58, r: 9, text: "ATP", tone: "gold" },
    { kind: "arrow", x: 56, y: 58, x2: 64, y2: 58, tone: "gold" },
    { kind: "text", x: 74, y: 78, text: "Turbine", tone: "gold" },
  ],
};
