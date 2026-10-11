/**
 * A teaching board is a short scene (what to draw, the exact labels, what
 * moves). This file places that scene. The model never picks pixel positions,
 * so a label cannot fall off the edge and two equations cannot occupy the
 * same spot.
 */

export type SceneLayout = "flow" | "graph" | "cycle" | "steps" | "stage" | "row";
export type SceneMotion = "flow" | "slide" | "press" | "cycle" | "steps" | "hold";
export type SceneTone = "rose" | "gold" | "blue" | "white";

export type ScenePart = {
  label: string;
  kind?: string;
  tone?: SceneTone;
};

export type BoardSceneSpec = {
  layout: SceneLayout;
  motion: SceneMotion;
  parts: ScenePart[];
  steps: string[];
};

const LAYOUTS = new Set<SceneLayout>(["flow", "graph", "cycle", "steps", "stage", "row"]);
const MOTIONS = new Set<SceneMotion>(["flow", "slide", "press", "cycle", "steps", "hold"]);
const TONES = new Set<SceneTone>(["rose", "gold", "blue", "white"]);

const FILL: Record<SceneTone, string> = {
  rose: "#e11d48",
  gold: "#f5c16c",
  blue: "#7eb6ff",
  white: "#fff7f4",
};

export function boardScenePrompt(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): string {
  const labels = input.labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length > 0 && label.length <= 42)
    .slice(0, 6);
  const labelRule =
    labels.length > 0
      ? `Use these labels, spelled exactly: ${labels.map((label) => `"${label}"`).join(", ")}.`
      : "Labels must be 1-4 words copied from the description.";
  return `Choose one teaching scene for this idea. Return it with the tool.
layout "steps" when the idea is a sequence of lines that replace each other, such as an equation being solved. Put every line in "steps", in order. The last line is the result and it must stay.
layout "graph" when the idea is curves on axes. Mark the downward curve kind "demand", the curve that shifts kind "supply", and the name of the shift kind "marker". motion "slide".
layout "cycle" when something circulates between places. Each place is a part with kind "station". motion "cycle".
layout "flow" when parts sit along a chain or a membrane and something moves along them. The last part is kind "end". motion "flow".
layout "stage" when one object acts on another, such as a stamp pressed onto a page. The acted-on object is kind "card", the refused or second object is kind "aside", a short extra label is kind "note". motion "press".
${labelRule}
Do not invent a label the description did not use. Do not include coordinates.

Idea: ${input.title.trim().slice(0, 120)}
Description: ${input.brief.trim().slice(0, 700)}
What moves: ${(input.motion ?? "").trim().slice(0, 300) || "only if the description itself changes"}`;
}

export function fallbackScene(input: {
  labels: string[];
  brief?: string;
  motion?: string;
}): BoardSceneSpec {
  const labels = cleanLines(input.labels, 42, 6);
  const equations = labels.filter((label) => label.includes("="));
  if (equations.length >= 2) {
    return { layout: "steps", motion: "steps", parts: [], steps: equations };
  }
  return {
    layout: "row",
    motion: "hold",
    parts: labels.map((label) => ({ label, tone: "rose" as const })),
    steps: [],
  };
}

/** Drops invented labels and puts any missing required label back on the board. */
export function constrainScene(spec: BoardSceneSpec, labels: string[]): BoardSceneSpec {
  const allowed = labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length > 0)
    .slice(0, 6);
  if (allowed.length === 0) return spec;
  const canonical = new Map(allowed.map((label) => [label.toLowerCase(), label]));
  const keep = (text: string) => canonical.get(text.toLowerCase());
  const parts = spec.parts
    .map((part) => {
      const label = keep(part.label);
      return label ? { ...part, label } : null;
    })
    .filter((part): part is ScenePart => Boolean(part));
  const steps = spec.steps.map((step) => keep(step)).filter((step): step is string => Boolean(step));
  if (spec.layout === "steps") {
    const lines = steps.length >= 2 ? steps : allowed;
    return { layout: "steps", motion: "steps", parts: [], steps: lines };
  }
  const seen = new Set(parts.map((part) => part.label.toLowerCase()));
  for (const label of allowed) {
    if (!seen.has(label.toLowerCase())) {
      parts.push({ label, kind: spec.layout === "cycle" ? "station" : "node" });
    }
  }
  return { ...spec, parts: parts.slice(0, 6), steps };
}

export function parseSceneSpec(raw: unknown): BoardSceneSpec | null {
  const record = asRecord(raw);
  if (!record) return null;
  const layout = LAYOUTS.has(record.layout as SceneLayout)
    ? (record.layout as SceneLayout)
    : null;
  const motion = MOTIONS.has(record.motion as SceneMotion)
    ? (record.motion as SceneMotion)
    : "hold";
  const parts = Array.isArray(record.parts)
    ? record.parts
        .map(asPart)
        .filter((part): part is ScenePart => Boolean(part))
        .slice(0, 6)
    : [];
  const steps = cleanLines(record.steps, 48, 4);
  if (!layout) return null;
  if (layout === "steps" && steps.length < 2 && parts.length === 0) return null;
  if (layout !== "steps" && parts.length === 0 && steps.length < 2) return null;
  return {
    layout,
    motion: layout === "steps" ? "steps" : motion,
    parts,
    steps: layout === "steps" ? (steps.length >= 2 ? steps : parts.map((part) => part.label)) : steps,
  };
}

/** Opacity of step `index` at time fraction `t` (0 at the start, 1 at the hold). */
export function stepOpacity(index: number, count: number, t: number): number {
  if (count <= 1) return 1;
  const time = Math.min(1, Math.max(0, t));
  const span = 0.72 / count;
  const start = index * span;
  if (index === count - 1) return time >= start ? 1 : 0;
  return time >= start && time < start + span ? 1 : 0;
}

export function renderBoardScene(spec: BoardSceneSpec): string {
  const body =
    spec.layout === "steps"
      ? renderSteps(spec.steps.length >= 2 ? spec.steps : spec.parts.map((part) => part.label))
      : spec.layout === "graph"
        ? renderGraph(spec)
        : spec.layout === "cycle"
          ? renderCycle(spec)
          : spec.layout === "stage"
            ? renderStage(spec)
            : spec.layout === "flow"
              ? renderFlow(spec)
              : renderRow(spec);
  return `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg" data-layout="${spec.layout}">
<style>
  text { font-family: system-ui, sans-serif; }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes protonUp {
    0% { transform: translateY(0); opacity: 0 }
    18% { opacity: 1 }
    75% { transform: translateY(-78px); opacity: 1 }
    100% { transform: translateY(-78px); opacity: 0 }
  }
  @keyframes protonDown {
    0% { transform: translateY(-70px); opacity: 0 }
    20% { opacity: 1 }
    100% { transform: translateY(64px); opacity: 0 }
  }
  @keyframes slideLeft {
    0%, 18% { transform: translateX(0) }
    62%, 100% { transform: translateX(-100px) }
  }
  @keyframes pressDown {
    0% { transform: translateY(-24px) }
    46%, 100% { transform: translateY(78px) }
  }
  @keyframes asideSlide {
    0%, 30% { transform: translateX(0) }
    70%, 100% { transform: translateX(36px) }
  }
  @keyframes travel {
    0% { offset-distance: 0%; opacity: 0 }
    12% { opacity: 1 }
    88% { opacity: 1 }
    100% { offset-distance: 100%; opacity: 0 }
  }
  .draw { animation: fadeIn 0.6s ease both }
  .up { animation: protonUp 2.6s ease-in-out infinite both }
  .down { animation: protonDown 2.4s ease-in-out infinite both }
  .supply { animation: slideLeft 4.2s ease forwards }
  .stamp { animation: pressDown 3.2s ease forwards }
  .aside { animation: asideSlide 3.6s ease forwards }
  .mover { offset-rotate: 0deg; animation: travel 4.8s linear infinite }
</style>
<rect width="960" height="540" fill="#140c10"/>
${body}
</svg>`;
}

function renderSteps(steps: string[]): string {
  const lines = steps.slice(0, 4);
  const count = lines.length;
  const dur = Math.max(6, count * 2.4);
  const css = lines
    .map((_, index) => {
      const name = `step${index}`;
      return `.${name}{animation:${name} ${dur}s linear forwards}${keyframes(name, index, count)}`;
    })
    .join("");
  const texts = lines
    .map((line, index) => {
      const size = line.length > 18 ? 40 : 52;
      return `<text class="step${index}" x="480" y="290" text-anchor="middle" font-size="${size}" font-weight="650" fill="#fff7f4">${esc(line)}</text>`;
    })
    .join("");
  return `<style>${css}</style>${texts}`;
}

function keyframes(name: string, index: number, count: number): string {
  const span = 72 / count;
  const start = Math.round(index * span * 10) / 10;
  const end = Math.round((index + 1) * span * 10) / 10;
  const cut = Math.min(99.8, end + 0.2);
  if (index === count - 1) {
    return `@keyframes ${name}{0%,${start}%{opacity:0}${cut}%,100%{opacity:1}}`;
  }
  if (index === 0) {
    return `@keyframes ${name}{0%,${end}%{opacity:1}${cut}%,100%{opacity:0}}`;
  }
  return `@keyframes ${name}{0%,${start}%{opacity:0}${Math.min(99, start + 0.2)}%,${end}%{opacity:1}${cut}%,100%{opacity:0}}`;
}

function renderFlow(spec: BoardSceneSpec): string {
  const parts = spec.parts.slice(0, 6);
  const endIndex = parts.findIndex((part) => part.kind === "end" || part.tone === "gold");
  const end = endIndex >= 0 ? parts[endIndex] : parts[parts.length - 1];
  const nodes = parts.filter((part) => part !== end);
  const slot = 760 / Math.max(nodes.length + 1, 2);
  const nodesSvg = nodes
    .map((part, index) => {
      const x = 90 + slot * (index + 0.35);
      const tone = part.tone ?? "rose";
      return `<g class="draw" style="animation-delay:${index * 0.12}s">
        <rect x="${x - 28}" y="236" width="56" height="72" rx="10" fill="${FILL[tone]}"/>
        ${label(part.label, x, 338, 16, tone === "white" ? "#140c10" : "#fff7f4", 90)}
      </g>
      <circle class="up" cx="${x}" cy="250" r="6" fill="#fff7f4" style="animation-delay:${0.4 + index * 0.35}s"/>`;
    })
    .join("");
  const endX = 860;
  return `${nodesSvg}
    <rect x="70" y="268" width="820" height="16" rx="8" fill="#e11d48" opacity="0.85"/>
    <rect x="70" y="290" width="820" height="12" rx="6" fill="#e11d48" opacity="0.45"/>
    <g class="draw">
      <circle cx="${endX}" cy="276" r="28" fill="${FILL[end?.tone ?? "gold"]}"/>
      <ellipse cx="${endX}" cy="276" rx="18" ry="6" fill="#140c10" opacity="0.35"/>
      ${label(end?.label ?? "", endX, 348, 15, "#f5c16c", 150)}
    </g>
    <circle class="down" cx="${endX}" cy="276" r="5" fill="#fff7f4"/>
    <circle class="down" cx="${endX - 8}" cy="270" r="5" fill="#fff7f4" style="animation-delay:.8s"/>`;
}

function renderGraph(spec: BoardSceneSpec): string {
  const demand = spec.parts.find((part) => part.kind === "demand") ?? spec.parts[0];
  const supply = spec.parts.find((part) => part.kind === "supply") ?? spec.parts[1] ?? spec.parts[0];
  const marker = spec.parts.find((part) => part.kind === "marker") ?? spec.parts[2];
  return `<line x1="120" y1="70" x2="120" y2="450" stroke="#fff7f4" stroke-width="2"/>
    <line x1="120" y1="450" x2="860" y2="450" stroke="#fff7f4" stroke-width="2"/>
    <polygon points="120,62 115,76 125,76" fill="#fff7f4"/>
    <polygon points="868,450 854,445 854,455" fill="#fff7f4"/>
    <text x="96" y="200" fill="#fff7f4" font-size="14" transform="rotate(-90 96 200)">Price</text>
    <text x="470" y="486" fill="#fff7f4" font-size="14" text-anchor="middle">Quantity</text>
    <line x1="200" y1="110" x2="780" y2="400" stroke="${FILL[demand?.tone ?? "blue"]}" stroke-width="4"/>
    ${label(demand?.label ?? "", 800, 392, 16, FILL[demand?.tone ?? "blue"], 140)}
    <g class="supply">
      <line x1="230" y1="400" x2="800" y2="120" stroke="${FILL[supply?.tone ?? "rose"]}" stroke-width="4"/>
      ${label(supply?.label ?? "", 790, 108, 16, FILL[supply?.tone ?? "rose"], 140)}
      <circle cx="520" cy="268" r="7" fill="${FILL[marker?.tone ?? "gold"]}"/>
      ${marker ? label(marker.label, 548, 250, 15, FILL[marker.tone ?? "gold"], 120) : ""}
    </g>`;
}

function renderCycle(spec: BoardSceneSpec): string {
  const spots = [
    { x: 180, y: 150 },
    { x: 480, y: 120 },
    { x: 760, y: 250 },
    { x: 340, y: 400 },
  ];
  const parts = spec.parts.slice(0, 4);
  const stations = parts
    .map((part, index) => {
      const spot = spots[index] ?? spots[0];
      const tone = part.tone ?? (index === 0 ? "gold" : index === 2 ? "blue" : "white");
      const shape =
        index === 0
          ? `<circle cx="${spot.x}" cy="${spot.y}" r="36" fill="${FILL[tone]}"/>`
          : index === 1
            ? `<ellipse cx="${spot.x}" cy="${spot.y}" rx="54" ry="28" fill="${FILL[tone]}"/>`
            : index === 2
              ? `<polygon points="${spot.x},${spot.y - 40} ${spot.x + 48},${spot.y + 36} ${spot.x - 48},${spot.y + 36}" fill="${FILL[tone]}"/>`
              : `<ellipse cx="${spot.x}" cy="${spot.y}" rx="70" ry="26" fill="${FILL[tone]}"/>`;
      return `<g class="draw" style="animation-delay:${index * 0.15}s">${shape}${label(part.label, spot.x, spot.y + (index === 3 ? 48 : 58), 15, "#fff7f4", 160)}</g>`;
    })
    .join("");
  const path = "M 180 150 C 300 40, 400 40, 480 120 C 620 80, 700 140, 760 250 C 700 360, 520 430, 340 400 C 220 370, 140 260, 180 150";
  const dots = [0, 1.6, 3.2]
    .map(
      (delay) =>
        `<circle class="mover" r="6" fill="#fff7f4" style="offset-path:path('${path}');animation-delay:${delay}s"/>`
    )
    .join("");
  return `${stations}${dots}`;
}

function renderStage(spec: BoardSceneSpec): string {
  const aside = spec.parts.find((part) => part.kind === "aside");
  const note =
    spec.parts.find((part) => part.kind === "note") ??
    spec.parts.find((part) => /^\d{3,4}$/.test(part.label));
  const subject =
    spec.parts.find((part) => part !== aside && part !== note && part.kind !== "note") ??
    spec.parts[0];
  const press = spec.motion === "press" || spec.motion === "slide";
  return `<g>
      <rect x="150" y="170" width="250" height="180" rx="16" fill="#fff7f4"/>
      <rect x="174" y="198" width="200" height="8" rx="4" fill="#140c10" opacity="0.2"/>
      <rect x="174" y="218" width="170" height="8" rx="4" fill="#140c10" opacity="0.15"/>
      ${label(subject?.label ?? "", 275, 390, 18, "#e11d48", 230)}
    </g>
    <g class="aside">
      <rect x="500" y="190" width="230" height="160" rx="16" fill="#fff7f4"/>
      <line x1="540" y1="230" x2="690" y2="320" stroke="#e11d48" stroke-width="6"/>
      <line x1="690" y1="230" x2="540" y2="320" stroke="#e11d48" stroke-width="6"/>
      ${label(aside?.label ?? "", 615, 390, 18, "#f5c16c", 210)}
    </g>
    ${
      press
        ? `<g class="stamp">
            <rect x="248" y="78" width="54" height="28" rx="6" fill="#f5c16c"/>
            <rect x="258" y="106" width="34" height="40" rx="4" fill="#e11d48"/>
          </g>`
        : ""
    }
    ${note ? label(note.label, 120, 300, 18, "#f5c16c", 100) : ""}`;
}

function renderRow(spec: BoardSceneSpec): string {
  const parts = spec.parts.slice(0, 6);
  if (parts.length === 0) {
    return `<text x="480" y="280" text-anchor="middle" fill="#fff7f4" font-size="28"> </text>`;
  }
  const slot = 820 / parts.length;
  return parts
    .map((part, index) => {
      const x = 70 + slot * index + slot / 2;
      const tone = part.tone ?? "rose";
      return `<g class="draw" style="animation-delay:${index * 0.1}s">
        <rect x="${x - 70}" y="190" width="140" height="120" rx="16" fill="${FILL[tone]}"/>
        ${label(part.label, x, 360, 16, "#fff7f4", Math.min(150, slot - 16))}
      </g>`;
    })
    .join("");
}

function label(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  maxWidth: number
): string {
  const shown = text.replace(/\s+/g, " ").trim();
  if (!shown) return "";
  let font = size;
  while (font > 11 && shown.length * font * 0.56 > maxWidth) font -= 1;
  const half = (shown.length * font * 0.56) / 2;
  const cx = Math.min(940 - half, Math.max(20 + half, x));
  const cy = Math.min(510, Math.max(28, y));
  return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="${font}" font-weight="650" fill="${fill}">${esc(shown)}</text>`;
}

function cleanLines(raw: unknown, max: number, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.replace(/\s+/g, " ").trim().slice(0, max) : ""))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function asPart(raw: unknown): ScenePart | null {
  const record = asRecord(raw);
  if (!record || typeof record.label !== "string") return null;
  const label = record.label.replace(/\s+/g, " ").trim().slice(0, 42);
  if (!label) return null;
  const tone = TONES.has(record.tone as SceneTone) ? (record.tone as SceneTone) : undefined;
  const kind = typeof record.kind === "string" ? record.kind.slice(0, 16) : undefined;
  return { label, tone, kind };
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
