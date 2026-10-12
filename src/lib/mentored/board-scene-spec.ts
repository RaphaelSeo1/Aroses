/**
 * A teaching board is a short scene: which objects to draw, the exact labels,
 * and what moves. The model names those objects. This file places them.
 * It never reuses one diagram for a different idea. A bond is atoms and
 * electrons. A membrane is a membrane. A market is a graph.
 */

export type SceneMotion =
  | "share"
  | "transfer"
  | "flow"
  | "slide"
  | "press"
  | "cycle"
  | "steps"
  | "hold";

export type SceneTone = "rose" | "gold" | "blue" | "white";

export type GlyphRole =
  | "atom"
  | "electron"
  | "membrane"
  | "complex"
  | "rotor"
  | "proton"
  | "demand"
  | "supply"
  | "marker"
  | "page"
  | "stamp"
  | "aside"
  | "note"
  | "station"
  | "object";

export type SceneGlyph = {
  role: GlyphRole;
  label?: string;
  tone?: SceneTone;
};

export type BoardSceneSpec = {
  motion: SceneMotion;
  glyphs: SceneGlyph[];
  steps: string[];
};

type PictureKind = "bond" | "membrane" | "graph" | "stage" | "cycle" | "steps" | "objects" | "free";

const MOTIONS = new Set<SceneMotion>([
  "share",
  "transfer",
  "flow",
  "slide",
  "press",
  "cycle",
  "steps",
  "hold",
]);
const TONES = new Set<SceneTone>(["rose", "gold", "blue", "white"]);
const ROLES = new Set<GlyphRole>([
  "atom",
  "electron",
  "membrane",
  "complex",
  "rotor",
  "proton",
  "demand",
  "supply",
  "marker",
  "page",
  "stamp",
  "aside",
  "note",
  "station",
  "object",
]);

const FILL: Record<SceneTone, string> = {
  rose: "#e11d48",
  gold: "#f5c16c",
  blue: "#7eb6ff",
  white: "#fff7f4",
};

const LEGACY_ROLE: Record<string, GlyphRole> = {
  node: "object",
  end: "rotor",
  card: "page",
  aside: "aside",
  note: "note",
  demand: "demand",
  supply: "supply",
  marker: "marker",
  station: "station",
};

const BOND_WORDS =
  /chemical bond|covalent|ionic|shared electron|sharing electron|valence|hold atoms|atoms together|atoms share|transfer(?:s|red)? an electron|electron (?:is )?transferred/;
const MEMBRANE_WORDS =
  /membrane|bilayer|chemiosmos|atp synthase|proton|electron transport/;

export function boardScenePrompt(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): string {
  const labels = cleanLines(input.labels, 42, 6);
  const labelRule =
    labels.length > 0
      ? `Use these labels, spelled exactly, each at most once: ${labels.map((label) => `"${label}"`).join(", ")}.`
      : "A glyph may omit its label. Do not invent a word the description did not use.";
  return `Name the objects that depict this idea. Return them with the tool. Do not include coordinates.
role "atom" is one atom. role "electron" is the electrons of a bond. Use two atoms when a bond joins two atoms. motion "share" when those electrons are shared. motion "transfer" when an electron leaves one atom for another. A bond is never a membrane.
role "membrane" is a cell membrane. role "complex" is a protein in it. role "rotor" is ATP synthase or a channel. role "proton" is a proton crossing it. motion "flow" only for that crossing.
role "demand" and role "supply" are the two curves. role "marker" is the tax or the shift. motion "slide".
role "page" is a document. role "stamp" is pressed onto it. role "aside" is the refusal or boycott. role "note" is a year or a short extra label. motion "press".
role "station" is a place in a cycle. motion "cycle".
When the idea is equations that replace each other, leave glyphs empty and put every line in "steps". motion "steps".
role "object" only when none of the roles above is the thing itself.
${labelRule}

Idea: ${input.title.trim().slice(0, 120)}
Description: ${input.brief.trim().slice(0, 700)}
What moves: ${(input.motion ?? "").trim().slice(0, 300) || "only if the description itself changes"}`;
}

export function fallbackScene(input: {
  labels: string[];
  brief?: string;
  motion?: string;
  title?: string;
}): BoardSceneSpec {
  const labels = cleanLines(input.labels, 42, 6);
  const equations = labels.filter((label) => label.includes("="));
  if (equations.length >= 2) {
    return { motion: "steps", glyphs: [], steps: equations };
  }
  return {
    motion: "hold",
    glyphs: labels.map((label) => ({ role: "object" as const, label, tone: "rose" as const })),
    steps: [],
  };
}

/** Drops invented labels and puts any missing required label back on the board. */
export function constrainScene(spec: BoardSceneSpec, labels: string[]): BoardSceneSpec {
  const allowed = cleanLines(labels, 42, 6);
  if (allowed.length === 0) return spec;
  const canonical = new Map(allowed.map((label) => [label.toLowerCase(), label]));
  const keep = (text: string) => canonical.get(text.toLowerCase());
  if (spec.motion === "steps") {
    const steps = spec.steps.map((step) => keep(step)).filter((step): step is string => Boolean(step));
    return { motion: "steps", glyphs: [], steps: steps.length >= 2 ? steps : allowed };
  }
  const glyphs: SceneGlyph[] = [];
  for (const glyph of spec.glyphs) {
    if (!glyph.label) {
      glyphs.push(glyph);
      continue;
    }
    const label = keep(glyph.label);
    if (!label) continue;
    glyphs.push({ ...glyph, label });
  }
  const seen = new Set(glyphs.map((glyph) => glyph.label?.toLowerCase()).filter(Boolean));
  const filler = fillerRole(spec);
  for (const label of allowed) {
    if (!seen.has(label.toLowerCase())) glyphs.push({ role: filler, label });
  }
  return { ...spec, glyphs: glyphs.slice(0, 8) };
}

/**
 * The picture has to match the description. A membrane scene is kept only
 * when the description is about a membrane. Anything else is redrawn.
 */
export function reconcileScene(
  spec: BoardSceneSpec | null,
  input: { title?: string; brief?: string; labels: string[]; motion?: string }
): BoardSceneSpec {
  const parsed = spec ? constrainScene(spec, input.labels) : fallbackScene(input);
  const want = pictureKind(input);
  if (want === "free") {
    const text = blob(input);
    if (kindOf(parsed) === "membrane" && !MEMBRANE_WORDS.test(text)) {
      return sceneForKind("objects", input);
    }
    return parsed;
  }
  return sceneForKind(want, input);
}

export function parseSceneSpec(raw: unknown): BoardSceneSpec | null {
  const record = asRecord(raw);
  if (!record) return null;
  const motion = MOTIONS.has(record.motion as SceneMotion)
    ? (record.motion as SceneMotion)
    : "hold";
  let glyphs = Array.isArray(record.glyphs)
    ? record.glyphs.map(asGlyph).filter((glyph): glyph is SceneGlyph => Boolean(glyph))
    : [];
  if (glyphs.length === 0 && Array.isArray(record.parts)) {
    glyphs = record.parts.map(asLegacyPart).filter((glyph): glyph is SceneGlyph => Boolean(glyph));
  }
  const steps = cleanLines(record.steps, 48, 4);
  if ((motion === "steps" || record.layout === "steps") && (steps.length >= 2 || glyphs.length >= 2)) {
    const lines = steps.length >= 2 ? steps : glyphs.map((glyph) => glyph.label).filter((label): label is string => Boolean(label));
    if (lines.length >= 2) return { motion: "steps", glyphs: [], steps: lines };
  }
  if (glyphs.length === 0 && steps.length < 2) return null;
  return { motion, glyphs: glyphs.slice(0, 8), steps };
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
  const kind = kindOf(spec);
  const body =
    kind === "steps"
      ? renderSteps(spec.steps.length >= 2 ? spec.steps : spec.glyphs.map((glyph) => glyph.label ?? ""))
      : kind === "membrane"
        ? renderMembrane(spec)
        : kind === "bond"
          ? renderBond(spec)
          : kind === "graph"
            ? renderGraph(spec)
            : kind === "stage"
              ? renderStage(spec)
              : kind === "cycle"
                ? renderCycle(spec)
                : renderObjects(spec);
  return `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" data-layout="${kind}">
<style>
  text { font-family: system-ui, sans-serif; }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes drift {
    0%, 100% { transform: translateY(0) }
    50% { transform: translateY(10px) }
  }
  @keyframes hop {
    0%, 18% { transform: translateX(0) }
    72%, 100% { transform: translateX(250px) }
  }
  @keyframes charge {
    0%, 58% { opacity: 0 }
    82%, 100% { opacity: 1 }
  }
  @keyframes protonUp {
    0% { transform: translateY(10px); opacity: 0 }
    18% { opacity: 1 }
    75% { transform: translateY(-52px); opacity: 1 }
    100% { transform: translateY(-52px); opacity: 0 }
  }
  @keyframes protonDown {
    0% { transform: translateY(-24px); opacity: 0 }
    20% { opacity: 1 }
    100% { transform: translateY(110px); opacity: 0 }
  }
  @keyframes slideLeft {
    0%, 12% { transform: translateX(110px) }
    70%, 100% { transform: translateX(0) }
  }
  @keyframes pressDown {
    0% { transform: translateY(0) }
    58%, 100% { transform: translateY(234px) }
  }
  @keyframes ink {
    0%, 52% { opacity: 0 }
    74%, 100% { opacity: 1 }
  }
  @keyframes asideSlide {
    0%, 30% { transform: translateX(0) }
    70%, 100% { transform: translateX(28px) }
  }
  @keyframes travel {
    0% { offset-distance: 0%; opacity: 0 }
    12% { opacity: 1 }
    88% { opacity: 1 }
    100% { offset-distance: 100%; opacity: 0 }
  }
  .draw { animation: fadeIn 0.6s ease both }
  .electron { transform-box: fill-box; transform-origin: center; animation: drift 2.8s ease-in-out infinite }
  .hop { transform-box: fill-box; transform-origin: center; animation: hop 3.4s ease-in-out infinite }
  .charge { animation: charge 3.4s ease forwards }
  .up { transform-box: fill-box; transform-origin: center; animation: protonUp 2.6s ease-in-out infinite both }
  .down { transform-box: fill-box; transform-origin: center; animation: protonDown 2.4s ease-in-out infinite both }
  .supply { animation: slideLeft 4.2s ease forwards }
  .stamp { animation: pressDown 3.2s ease forwards }
  .mark { animation: ink 3.2s ease forwards }
  .aside { animation: asideSlide 3.6s ease forwards }
  .mover { offset-rotate: 0deg; animation: travel 4.8s linear infinite }
</style>
<rect width="960" height="540" fill="#140c10"/>
${body}
</svg>`;
}

function pictureKind(input: {
  title?: string;
  brief?: string;
  labels?: string[];
  motion?: string;
}): PictureKind {
  const labels = cleanLines(input.labels, 42, 6);
  if (labels.filter((label) => label.includes("=")).length >= 2) return "steps";
  const text = blob(input);
  const bond = BOND_WORDS.test(text);
  const membrane = MEMBRANE_WORDS.test(text);
  if (bond && !membrane) return "bond";
  if (membrane && !bond) return "membrane";
  if (bond && membrane) {
    if (/chemical bond|covalent|ionic|hold atoms|atoms together|shared electron|transfer(?:s|red)? an electron/.test(text)) return "bond";
    return "membrane";
  }
  const stage = /stamp|boycott|colonist|newspaper/.test(text);
  const graph = /supply|demand/.test(text) && /curve|price|quantity|tax|shift|market/.test(text);
  if (stage && !/supply curve|demand curve/.test(text)) return "stage";
  if (graph) return "graph";
  if (/evaporation|condensation|precipitation|water cycle/.test(text)) return "cycle";
  return "free";
}

function sceneForKind(
  kind: Exclude<PictureKind, "free">,
  input: { title?: string; brief?: string; labels: string[]; motion?: string }
): BoardSceneSpec {
  const labels = cleanLines(input.labels, 42, 6);
  const text = blob(input);
  if (kind === "steps") {
    const equations = labels.filter((label) => label.includes("="));
    return { motion: "steps", glyphs: [], steps: equations.length >= 2 ? equations : labels };
  }
  if (kind === "bond") return bondSpec(labels, text);
  if (kind === "membrane") return membraneSpec(labels, text);
  if (kind === "graph") return graphSpec(labels);
  if (kind === "stage") return stageSpec(labels);
  if (kind === "cycle") {
    return {
      motion: "cycle",
      glyphs: labels.map((label, index) => ({
        role: "station" as const,
        label,
        tone: (["gold", "white", "blue", "rose"] as const)[index % 4],
      })),
      steps: [],
    };
  }
  return {
    motion: "hold",
    glyphs: labels.map((label) => ({ role: "object" as const, label, tone: "white" as const })),
    steps: [],
  };
}

function bondSpec(labels: string[], text: string): BoardSceneSpec {
  const transfer = /transfer|ionic|gives up|loses an electron|gains an electron|donates/.test(text)
    && !/share|covalent|shared/.test(text);
  const atomLabels = labels.filter((label) => isAtomName(label));
  const captions = labels.filter((label) => !isAtomName(label));
  const glyphs: SceneGlyph[] = [
    { role: "atom", label: atomLabels[0], tone: "rose" },
    { role: "atom", label: atomLabels[1], tone: "gold" },
    { role: "electron", label: captions[0], tone: "blue" },
  ];
  for (const label of captions.slice(1)) glyphs.push({ role: "note", label, tone: "gold" });
  for (const label of atomLabels.slice(2)) glyphs.push({ role: "note", label, tone: "white" });
  return { motion: transfer ? "transfer" : "share", glyphs, steps: [] };
}

function isAtomName(label: string): boolean {
  if (/bond|force|electron|share|together|hold|membrane|proton|supply|demand/i.test(label)) return false;
  return label.length <= 16;
}

function membraneSpec(labels: string[], text: string): BoardSceneSpec {
  const rotorLabel = labels.find((label) => /synthase|turbine|\batp\b|channel/i.test(label));
  const protonLabel = labels.find((label) => /proton|gradient|h\+/i.test(label));
  const membraneLabel = labels.find((label) => /membrane|bilayer/i.test(label));
  const skip = new Set([rotorLabel, protonLabel, membraneLabel].filter((label): label is string => Boolean(label)));
  const complexes = labels.filter((label) => !skip.has(label));
  const glyphs: SceneGlyph[] = [{ role: "membrane", label: membraneLabel, tone: "rose" }];
  if (complexes.length === 0) glyphs.push({ role: "complex", tone: "rose" });
  else for (const label of complexes) glyphs.push({ role: "complex", label, tone: "rose" });
  if (rotorLabel || /synthase|turbine|\batp\b/.test(text)) {
    glyphs.push({ role: "rotor", label: rotorLabel, tone: "gold" });
  }
  if (protonLabel || /proton|chemiosm|gradient|pump/.test(text)) {
    glyphs.push({ role: "proton", label: protonLabel, tone: "white" });
  }
  return { motion: "flow", glyphs, steps: [] };
}

function graphSpec(labels: string[]): BoardSceneSpec {
  const demand = labels.find((label) => /demand/i.test(label));
  const supply = labels.find((label) => /supply/i.test(label));
  const used = new Set([demand, supply].filter((label): label is string => Boolean(label)));
  const marker = labels.find((label) => !used.has(label));
  const glyphs: SceneGlyph[] = [];
  const demandLabel = demand ?? labels[0];
  const supplyLabel = supply ?? labels.find((label) => label !== demandLabel);
  if (demandLabel) glyphs.push({ role: "demand", label: demandLabel, tone: "blue" });
  if (supplyLabel) glyphs.push({ role: "supply", label: supplyLabel, tone: "rose" });
  if (marker && marker !== demandLabel && marker !== supplyLabel) {
    glyphs.push({ role: "marker", label: marker, tone: "gold" });
  }
  return { motion: "slide", glyphs, steps: [] };
}

function stageSpec(labels: string[]): BoardSceneSpec {
  const note = labels.find((label) => /^\d{3,4}$/.test(label.trim()));
  const aside = labels.find((label) => label !== note && /boycott|refus|protest|repeal/i.test(label));
  const page = labels.find((label) => label !== note && label !== aside);
  const glyphs: SceneGlyph[] = [];
  if (page) glyphs.push({ role: "page", label: page, tone: "rose" });
  glyphs.push({ role: "stamp", tone: "gold" });
  if (aside) glyphs.push({ role: "aside", label: aside, tone: "gold" });
  if (note) glyphs.push({ role: "note", label: note, tone: "gold" });
  for (const label of labels) {
    if (label !== page && label !== aside && label !== note) glyphs.push({ role: "note", label, tone: "white" });
  }
  return { motion: "press", glyphs, steps: [] };
}

function kindOf(spec: BoardSceneSpec): Exclude<PictureKind, "free"> {
  if (spec.motion === "steps" || spec.steps.length >= 2) return "steps";
  const roles = new Set(spec.glyphs.map((glyph) => glyph.role));
  if (roles.has("membrane") || roles.has("complex") || roles.has("rotor") || roles.has("proton")) {
    return "membrane";
  }
  if (roles.has("atom") || roles.has("electron")) return "bond";
  if (roles.has("demand") || roles.has("supply")) return "graph";
  if (roles.has("page") || roles.has("stamp") || roles.has("aside")) return "stage";
  if (roles.has("station")) return "cycle";
  return "objects";
}

function fillerRole(spec: BoardSceneSpec): GlyphRole {
  const kind = kindOf(spec);
  if (kind === "cycle") return "station";
  if (kind === "membrane") return "complex";
  if (kind === "graph") return "marker";
  if (kind === "stage") return "note";
  if (kind === "bond") return "note";
  return "object";
}

function renderBond(spec: BoardSceneSpec): string {
  const atoms = spec.glyphs.filter((glyph) => glyph.role === "atom");
  const captions = spec.glyphs
    .filter((glyph) => glyph.role === "electron" || glyph.role === "note" || glyph.role === "object")
    .map((glyph) => glyph.label)
    .filter((label): label is string => Boolean(label));
  const transfer = spec.motion === "transfer";
  const left = { x: transfer ? 280 : 390, y: 230 };
  const right = { x: transfer ? 680 : 570, y: 230 };
  const radius = transfer ? 96 : 118;
  const shells = [
    atom(left.x, left.y, radius, atoms[0]?.tone ?? "rose", atoms[0]?.label, 0),
    atom(right.x, right.y, radius, atoms[1]?.tone ?? "gold", atoms[1]?.label, 1),
  ].join("");
  const electrons = transfer
    ? `<g class="hop" data-role="electron"><circle cx="${left.x + radius - 8}" cy="${left.y}" r="9" fill="#7eb6ff"/></g>
       <line x1="${left.x + radius + 16}" y1="${left.y + 36}" x2="${right.x - radius - 28}" y2="${left.y + 36}" stroke="#f5c16c" stroke-width="3" marker-end="url(#bond-arrow)"/>
       <text class="charge" x="${left.x}" y="${left.y - 8}" text-anchor="middle" fill="#fff7f4" font-size="28" font-weight="700">+</text>
       <text class="charge" x="${right.x}" y="${right.y - 8}" text-anchor="middle" fill="#fff7f4" font-size="28" font-weight="700">−</text>`
    : `<g data-role="electron">
        <circle class="electron" cx="${(left.x + right.x) / 2}" cy="${left.y - 18}" r="11" fill="#7eb6ff"/>
        <circle class="electron" cx="${(left.x + right.x) / 2}" cy="${left.y + 18}" r="11" fill="#7eb6ff" style="animation-delay:-1.4s"/>
      </g>`;
  const caption = captions
    .map((line, index) =>
      label(line, 480, 430 + index * 42, index === 0 ? 26 : 20, index === 0 ? "#fff7f4" : "#f5c16c", 760)
    )
    .join("");
  return `${shells}${electrons}${caption}
    <defs><marker id="bond-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#f5c16c"/></marker></defs>`;
}

function atom(cx: number, cy: number, radius: number, tone: SceneTone, name: string | undefined, index: number): string {
  const color = FILL[tone];
  const outward = index === 0 ? 180 : 0;
  const electrons = [-42, 0, 42]
    .map((delta) => {
      const angle = ((outward + delta) * Math.PI) / 180;
      const x = cx + Math.cos(angle) * (radius - 4);
      const y = cy + Math.sin(angle) * (radius - 4);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="#fff7f4"/>`;
    })
    .join("");
  return `<g data-role="atom" class="draw" style="animation-delay:${index * 0.12}s">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="20" fill="${color}"/>
    ${electrons}
    ${name ? label(name, cx, cy + radius + 36, 18, color, 200) : ""}
  </g>`;
}

function renderMembrane(spec: BoardSceneSpec): string {
  const membrane = spec.glyphs.find((glyph) => glyph.role === "membrane");
  const named = spec.glyphs.filter((glyph) => glyph.role === "complex");
  const complexes = named.length <= 1 ? Array.from({ length: 3 }, (_, index) => named[0] ?? { role: "complex" as const, tone: "rose" as const }) .map((glyph, index) => (index === 1 ? glyph : { ...glyph, label: named.length === 1 ? undefined : glyph.label })) : named.slice(0, 4);
  const rotor = spec.glyphs.find((glyph) => glyph.role === "rotor");
  const proton = spec.glyphs.find((glyph) => glyph.role === "proton");
  const left = 150;
  const right = rotor ? 620 : 820;
  const slot = (right - left) / Math.max(complexes.length, 1);
  const proteins = complexes
    .map((glyph, index) => {
      const x = left + slot * (index + 0.5);
      const tone = glyph.tone ?? "rose";
      return `<g class="draw" data-role="complex" style="animation-delay:${index * 0.1}s">
        <rect x="${x - 26}" y="188" width="52" height="150" rx="16" fill="${FILL[tone]}"/>
        <rect x="${x - 16}" y="214" width="32" height="18" rx="6" fill="#140c10" opacity="0.28"/>
        ${glyph.label ? label(glyph.label, x, 390, 16, "#fff7f4", Math.min(160, slot - 8)) : ""}
        <g data-role="proton">
          <circle cx="${x}" cy="156" r="11" fill="#fff7f4"/>
          <text x="${x}" y="160" text-anchor="middle" fill="#140c10" font-size="14" font-weight="700">+</text>
        </g>
        <g class="up" style="animation-delay:${0.25 + index * 0.45}s">
          <circle cx="${x}" cy="188" r="8" fill="#fff7f4"/>
          <text x="${x}" y="192" text-anchor="middle" fill="#140c10" font-size="12" font-weight="700">+</text>
        </g>
      </g>`;
    })
    .join("");
  const rotorSvg = rotor
    ? `<g data-role="rotor" class="draw">
        <rect x="792" y="230" width="28" height="96" rx="8" fill="#f5c16c"/>
        <circle cx="806" cy="196" r="46" fill="#f5c16c"/>
        <circle cx="806" cy="196" r="16" fill="#140c10"/>
        <circle cx="806" cy="168" r="6" fill="#140c10" opacity="0.45"/>
        <circle cx="828" cy="206" r="6" fill="#140c10" opacity="0.45"/>
        <circle cx="784" cy="206" r="6" fill="#140c10" opacity="0.45"/>
        ${label(rotor.label ?? "", 806, 420, 16, "#f5c16c", 180)}
        <g data-role="proton">
          <circle cx="806" cy="248" r="9" fill="#fff7f4"/>
          <text x="806" y="252" text-anchor="middle" fill="#140c10" font-size="12" font-weight="700">+</text>
        </g>
        <g class="down"><circle cx="806" cy="150" r="8" fill="#fff7f4"/><text x="806" y="154" text-anchor="middle" fill="#140c10" font-size="12" font-weight="700">+</text></g>
        <g class="down" style="animation-delay:.7s"><circle cx="806" cy="150" r="8" fill="#fff7f4"/><text x="806" y="154" text-anchor="middle" fill="#140c10" font-size="12" font-weight="700">+</text></g>
      </g>`
    : "";
  return `<rect data-role="membrane" x="70" y="246" width="820" height="16" rx="8" fill="#e11d48"/>
    <rect data-role="membrane" x="70" y="272" width="820" height="14" rx="7" fill="#fb7185" opacity="0.55"/>
    ${proteins}
    ${rotorSvg}
    ${membrane?.label ? label(membrane.label, 168, 118, 16, "#fda4af", 220) : ""}
    ${proton?.label ? label(proton.label, 390, 118, 18, "#fff7f4", 240) : ""}`;
}

function renderGraph(spec: BoardSceneSpec): string {
  const demand = spec.glyphs.find((glyph) => glyph.role === "demand") ?? spec.glyphs[0];
  const supply = spec.glyphs.find((glyph) => glyph.role === "supply") ?? spec.glyphs[1] ?? spec.glyphs[0];
  const marker = spec.glyphs.find((glyph) => glyph.role === "marker");
  const notes = spec.glyphs.filter((glyph) => glyph.role === "note" && glyph.label);
  return `<line x1="140" y1="70" x2="140" y2="430" stroke="#fff7f4" stroke-width="3"/>
    <line x1="140" y1="430" x2="860" y2="430" stroke="#fff7f4" stroke-width="3"/>
    <polygon points="140,58 132,76 148,76" fill="#fff7f4"/>
    <polygon points="872,430 856,422 856,438" fill="#fff7f4"/>
    <text x="108" y="230" fill="#fff7f4" font-size="16" transform="rotate(-90 108 230)">Price</text>
    <text x="500" y="478" fill="#fff7f4" font-size="16" text-anchor="middle">Quantity</text>
    <line data-role="curve" x1="220" y1="110" x2="780" y2="390" stroke="${FILL[demand?.tone ?? "blue"]}" stroke-width="5"/>
    ${label(demand?.label ?? "", 800, 372, 18, FILL[demand?.tone ?? "blue"], 150)}
    <g opacity="0.55">
      <line x1="280" y1="400" x2="830" y2="130" stroke="${FILL[supply?.tone ?? "rose"]}" stroke-width="4" stroke-dasharray="12 9"/>
    </g>
    <line x1="610" y1="214" x2="512" y2="214" stroke="#f5c16c" stroke-width="3" marker-end="url(#shift-arrow)"/>
    <g class="supply">
      <line data-role="curve" x1="170" y1="400" x2="720" y2="130" stroke="${FILL[supply?.tone ?? "rose"]}" stroke-width="5"/>
      ${label(supply?.label ?? "", 742, 112, 18, FILL[supply?.tone ?? "rose"], 160)}
    </g>
    <circle cx="488" cy="244" r="8" fill="${FILL[marker?.tone ?? "gold"]}"/>
    ${marker?.label ? label(marker.label, 548, 200, 18, FILL[marker.tone ?? "gold"], 120) : ""}
    <defs><marker id="shift-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#f5c16c"/></marker></defs>
    ${notes.map((note, index) => label(note.label ?? "", 480, 510 - index * 24, 14, "#f5c16c", 400)).join("")}`;
}

function renderStage(spec: BoardSceneSpec): string {
  const page = spec.glyphs.find((glyph) => glyph.role === "page") ?? spec.glyphs[0];
  const aside = spec.glyphs.find((glyph) => glyph.role === "aside");
  const note = spec.glyphs.find((glyph) => glyph.role === "note");
  return `<g data-role="page">
      <rect x="150" y="130" width="270" height="250" rx="10" fill="#fff7f4"/>
      <rect x="174" y="158" width="190" height="12" rx="3" fill="#140c10" opacity="0.35"/>
      <rect x="174" y="184" width="210" height="8" rx="3" fill="#140c10" opacity="0.18"/>
      <rect x="174" y="204" width="180" height="8" rx="3" fill="#140c10" opacity="0.18"/>
      <rect x="174" y="224" width="200" height="8" rx="3" fill="#140c10" opacity="0.18"/>
      <circle class="mark" cx="285" cy="280" r="34" fill="none" stroke="#e11d48" stroke-width="6"/>
      <circle class="mark" cx="285" cy="280" r="18" fill="#e11d48" opacity="0.85"/>
      ${label(page?.label ?? "", 285, 420, 20, "#fff7f4", 280)}
    </g>
    <g class="stamp" data-role="stamp">
      <rect x="270" y="72" width="30" height="44" rx="6" fill="#e11d48"/>
      <circle cx="285" cy="46" r="30" fill="#f5c16c" stroke="#fff7f4" stroke-width="4"/>
      <circle cx="285" cy="46" r="12" fill="none" stroke="#140c10" stroke-width="3"/>
    </g>
    <g class="aside" data-role="aside">
      <rect x="560" y="150" width="250" height="230" rx="10" fill="#fff7f4"/>
      <line x1="600" y1="190" x2="770" y2="330" stroke="#e11d48" stroke-width="10" stroke-linecap="round"/>
      <line x1="770" y1="190" x2="600" y2="330" stroke="#e11d48" stroke-width="10" stroke-linecap="round"/>
      ${label(aside?.label ?? "", 685, 420, 20, "#f5c16c", 250)}
    </g>
    ${note?.label ? label(note.label, 96, 180, 22, "#f5c16c", 80) : ""}`;
}

function renderCycle(spec: BoardSceneSpec): string {
  const spots = [
    { x: 180, y: 160 },
    { x: 480, y: 130 },
    { x: 770, y: 250 },
    { x: 360, y: 400 },
  ];
  const parts = spec.glyphs.filter((glyph) => glyph.role === "station").slice(0, 4);
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
      return `<g class="draw" data-role="station" style="animation-delay:${index * 0.15}s">${shape}${label(part.label ?? "", spot.x, spot.y + (index === 3 ? 52 : 62), 16, "#fff7f4", 180)}</g>`;
    })
    .join("");
  const path = "M 180 160 C 300 50, 400 50, 480 130 C 640 90, 720 150, 770 250 C 700 360, 520 440, 360 400 C 230 370, 140 270, 180 160";
  const dots = [0, 1.6, 3.2]
    .map(
      (delay) =>
        `<circle class="mover" r="7" fill="#fff7f4" style="offset-path:path('${path}');animation-delay:${delay}s"/>`
    )
    .join("");
  return `${stations}${dots}`;
}

function renderObjects(spec: BoardSceneSpec): string {
  const glyphs = spec.glyphs.filter((glyph) => glyph.label).slice(0, 4);
  if (glyphs.length === 0) return "";
  const slot = 780 / glyphs.length;
  return glyphs
    .map((glyph, index) => {
      const x = 90 + slot * index + slot / 2;
      const tone = glyph.tone ?? "white";
      const shape =
        index % 2 === 0
          ? `<circle cx="${x}" cy="250" r="54" fill="${FILL[tone]}"/>`
          : `<rect x="${x - 60}" y="196" width="120" height="108" rx="18" fill="${FILL[tone]}"/>`;
      return `<g class="draw" data-role="object" style="animation-delay:${index * 0.1}s">${shape}${label(glyph.label ?? "", x, 390, 18, "#fff7f4", Math.min(200, slot - 12))}</g>`;
    })
    .join("");
}

function renderSteps(steps: string[]): string {
  const lines = steps.filter(Boolean).slice(0, 4);
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
  while (font > 12 && shown.length * font * 0.56 > maxWidth) font -= 1;
  const half = (shown.length * font * 0.56) / 2;
  const cx = Math.min(940 - half, Math.max(20 + half, x));
  const cy = Math.min(510, Math.max(28, y));
  return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="${font}" font-weight="650" fill="${fill}">${esc(shown)}</text>`;
}

function blob(input: { title?: string; brief?: string; labels?: string[]; motion?: string }): string {
  return [input.title, input.brief, ...(input.labels ?? []), input.motion]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .toLowerCase();
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

function asGlyph(raw: unknown): SceneGlyph | null {
  const record = asRecord(raw);
  if (!record || typeof record.role !== "string" || !ROLES.has(record.role as GlyphRole)) return null;
  const label = typeof record.label === "string" ? record.label.replace(/\s+/g, " ").trim().slice(0, 42) : "";
  const tone = TONES.has(record.tone as SceneTone) ? (record.tone as SceneTone) : undefined;
  return { role: record.role as GlyphRole, label: label || undefined, tone };
}

function asLegacyPart(raw: unknown): SceneGlyph | null {
  const record = asRecord(raw);
  if (!record || typeof record.label !== "string") return null;
  const label = record.label.replace(/\s+/g, " ").trim().slice(0, 42);
  if (!label) return null;
  const kind = typeof record.kind === "string" ? record.kind : "node";
  const role = LEGACY_ROLE[kind] ?? "object";
  const tone = TONES.has(record.tone as SceneTone) ? (record.tone as SceneTone) : undefined;
  return { role, label, tone };
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
