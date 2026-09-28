import type { LessonVisualAsset, LessonVisualAssetType } from "@/types/course";
import { extractFigureMarkers, splitParagraphs, type FigureMarker } from "./figure-markers.ts";
import type { BuildPage } from "./outline.ts";

/** Page-relative box, all values 0–1. */
export type Box = { x: number; y: number; w: number; h: number };

/** A crop found in a PDF without any AI. */
export type FigureCandidate = {
  /** Source page number (1-based, within its file). */
  page: number;
  origin: "raster" | "vector";
  box: Box;
  width: number;
  height: number;
  image: Buffer;
  mime: "image/png" | "image/jpeg";
  /** Small JPEG for the vision check. */
  thumb: Buffer;
  /** 0–1 from pixel checks; 0 means unusable. */
  quality: number;
  /** Pixel checks saw a ruled grid. */
  tableGrid: boolean;
  /** 64-bit difference hash (hex) of the crop, for spotting a picture repeated across slides. */
  hash?: string;
};

export type FigureKind = "diagram" | "chart" | "image" | "table";

/** A validated, stored figure the writer may place. */
export type FigureAsset = {
  id: string;
  /** Global page number used in writer prompts. */
  g: number;
  sourceIndex: number;
  page: number;
  kind: FigureKind;
  url: string;
  /** Caption line printed in the source ("Figure 3. …"), if any. */
  label: string;
  /** What the vision check says it shows, if it ran. */
  description: string;
  width: number;
  height: number;
};

export type FiguresStepOutput = {
  figures: FigureAsset[];
  candidates: number;
  checked: number;
  costUsd: number;
};

export const MAX_FIGURES_PER_PAGE = 3;
export const MAX_FIGURES_PER_BUILD = 30;
const MIN_AREA = 0.015;
const MAX_AREA = 0.8;
const HEADER_BAND = 0.1;
const FOOTER_BAND = 0.92;
const MIN_SIDE_PX = 80;
const MAX_ASPECT = 4;
const CONFIDENT_QUALITY = 0.6;
/** An embedded image this large is a whole picture, never a cut-off region. */
const CONFIDENT_RASTER_AREA = 0.06;

const CAPTION_RE = /^\s*((fig(?:ure)?|table|chart|diagram|exhibit|그림|표|도표)\s*\.?\s*\d+[a-z]?)\s*[.:)\-–]?\s*(.*)$/i;

export type CaptionLine = { text: string; table: boolean };

/** "Figure 3. …" / "Table 2: …" / "그림 1 …" lines, in page order. */
export function captionLines(pageText: string): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const raw of pageText.split("\n")) {
    const line = raw.trim();
    if (line.length < 4 || line.length > 220) continue;
    const m = CAPTION_RE.exec(line);
    if (!m) continue;
    // "Figure 3 shows …" mid-sentence is a reference, not a caption.
    if (/^(shows|illustrates|depicts|is|are|was|in|of)\b/i.test(m[3] ?? "")) continue;
    out.push({ text: line.slice(0, 160), table: /^(table|표|도표)/i.test(m[2]) });
  }
  return out;
}

function area(b: Box): number {
  return b.w * b.h;
}

function intersection(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

const SAME_BOX_TOLERANCE = 0.02;

function sameBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) <= SAME_BOX_TOLERANCE &&
    Math.abs(a.y - b.y) <= SAME_BOX_TOLERANCE &&
    Math.abs(a.x + a.w - (b.x + b.w)) <= SAME_BOX_TOLERANCE &&
    Math.abs(a.y + a.h - (b.y + b.h)) <= SAME_BOX_TOLERANCE
  );
}

/** Image boxes that repeat on several pages (logos, slide chrome). */
export function repeatedBoxes(boxesByPage: Map<number, Box[]>, pageCount: number): Box[] {
  const groups: Array<{ box: Box; pages: Set<number> }> = [];
  for (const [page, boxes] of boxesByPage) {
    for (const b of boxes) {
      const g = groups.find((x) => sameBox(x.box, b));
      if (g) g.pages.add(page);
      else groups.push({ box: b, pages: new Set([page]) });
    }
  }
  const min = Math.max(3, Math.ceil(pageCount * 0.2));
  return groups.filter((g) => g.pages.size >= min).map((g) => g.box);
}

export function isChromeBox(b: Box, repeated: Box[]): boolean {
  return repeated.some((r) => sameBox(r, b));
}

/** Why a candidate is dropped before any AI sees it, or null to keep it. */
export function rejectReason(c: FigureCandidate, repeated: Box[]): string | null {
  if (c.quality <= 0) return "unusable";
  if (c.width < MIN_SIDE_PX || c.height < MIN_SIDE_PX) return "small";
  const a = area(c.box);
  if (a < MIN_AREA) return "small";
  if (a > MAX_AREA) return "background";
  const aspect = c.width / c.height;
  if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) return "strip";
  if (c.box.y + c.box.h <= HEADER_BAND || c.box.y >= FOOTER_BAND) return "header";
  if (isChromeBox(c.box, repeated)) return "repeated";
  if (c.origin === "vector" && c.tableGrid) return "table_text";
  return null;
}

/** Drops crops mostly inside a better one on the same page. */
export function dedupe(cands: FigureCandidate[]): FigureCandidate[] {
  const byQuality = cands.slice().sort((a, b) => b.quality - a.quality || area(b.box) - area(a.box));
  const kept: FigureCandidate[] = [];
  for (const c of byQuality) {
    const covered = kept.some(
      (k) => k.page === c.page && intersection(k.box, c.box) > 0.6 * Math.min(area(k.box), area(c.box))
    );
    if (!covered) kept.push(c);
  }
  return kept;
}

export type Ranked = {
  candidate: FigureCandidate;
  label: string;
  table: boolean;
  confident: boolean;
};

/**
 * Filters and orders candidates. A figure is confident when the crop looks
 * clean and either the page prints a caption for it or it is a sizeable
 * embedded image. Drawn regions and small images need the vision check.
 */
export function rankCandidates(
  cands: FigureCandidate[],
  pageText: (page: number) => string,
  repeated: Box[]
): Ranked[] {
  const usable = dedupe(cands.filter((c) => rejectReason(c, repeated) == null));
  const byPage = new Map<number, FigureCandidate[]>();
  for (const c of usable) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);

  const out: Ranked[] = [];
  for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const top = list.sort((a, b) => b.quality * area(b.box) - a.quality * area(a.box)).slice(0, MAX_FIGURES_PER_PAGE);
    top.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const caps = captionLines(pageText(page));
    // Captions pair with crops top to bottom only when the counts agree.
    const paired = caps.length === top.length;
    top.forEach((c, i) => {
      const cap = paired ? caps[i] : caps.length === 1 && top.length === 1 ? caps[0] : undefined;
      const table = cap?.table ?? false;
      if (table && c.origin === "vector") return;
      out.push({
        candidate: c,
        label: cap?.text ?? "",
        table,
        confident:
          c.quality >= CONFIDENT_QUALITY &&
          (Boolean(cap) || (c.origin === "raster" && area(c.box) >= CONFIDENT_RASTER_AREA)),
      });
    });
  }
  return out;
}

/** The best candidates up to the vision budget go to review, in page order. */
export function splitForReview(ranked: Ranked[], visionSlots: number): { review: Ranked[]; unreviewed: Ranked[] } {
  const score = (r: Ranked) => (r.confident ? 1 : 0) + r.candidate.quality * area(r.candidate.box);
  const picked = new Set(
    ranked
      .slice()
      .sort((a, b) => score(b) - score(a))
      .slice(0, Math.max(0, visionSlots))
  );
  return { review: ranked.filter((r) => picked.has(r)), unreviewed: ranked.filter((r) => !picked.has(r)) };
}

/**
 * What survives: crops the vision check kept. Crops over the review budget are
 * dropped. If the check could not run (or is off), only confident crops survive.
 */
export function acceptFigures(
  split: { review: Ranked[]; unreviewed: Ranked[] },
  verdicts: Array<{ keep: boolean; kind: FigureKind; description: string } | null> | null
): Array<{ r: Ranked; kind: FigureKind; description: string }> {
  const fallbackKind = (r: Ranked): FigureKind =>
    r.table ? "table" : r.label || r.candidate.origin === "vector" ? "diagram" : "image";
  const out: Array<{ r: Ranked; kind: FigureKind; description: string }> = [];
  split.review.forEach((r, i) => {
    if (verdicts == null) {
      if (r.confident) out.push({ r, kind: fallbackKind(r), description: "" });
      return;
    }
    const v = verdicts[i];
    if (v?.keep) out.push({ r, kind: r.table ? "table" : v.kind, description: v.description });
  });
  if (verdicts == null) {
    for (const r of split.unreviewed) if (r.confident) out.push({ r, kind: fallbackKind(r), description: "" });
  }
  return out.sort((a, b) => a.r.candidate.page - b.r.candidate.page || a.r.candidate.box.y - b.r.candidate.box.y);
}

export function globalPage(pages: BuildPage[], sourceIndex: number, n: number): number | null {
  const exact = pages.find((p) => p.sourceIndex === sourceIndex && p.n === n);
  if (exact) return exact.g;
  // The page may have been cleaned away (no text); use the nearest earlier one.
  let best: BuildPage | null = null;
  for (const p of pages) if (p.sourceIndex === sourceIndex && p.n < n && (!best || p.n > best.n)) best = p;
  return best?.g ?? null;
}

/** One line per figure for the writer: about 20 tokens each. */
export function figureManifest(figures: FigureAsset[]): string {
  return figures
    .map((f) => {
      const bits = [f.label && `"${f.label}"`, f.description].filter(Boolean).join(" — ");
      return `[figure ${f.id}] ${f.kind}${bits ? `: ${bits}` : ""}`;
    })
    .join("\n");
}

export function figuresForPages(figures: FigureAsset[], pages: number[]): FigureAsset[] {
  const wanted = new Set(pages);
  return figures.filter((f) => wanted.has(f.g)).sort((a, b) => a.g - b.g || a.id.localeCompare(b.id));
}

const KIND_TO_TYPE: Record<FigureKind, LessonVisualAssetType> = {
  diagram: "diagram",
  chart: "chart",
  image: "image",
  table: "table",
};

function cleanCaption(raw: string, f: FigureAsset): string {
  const c = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return c || f.label || f.description || "";
}

function toVisualAsset(f: FigureAsset, caption: string, afterParagraph: number, assetPrefix: string): LessonVisualAsset {
  return {
    assetId: `${assetPrefix}${f.id}`,
    imageUrl: f.url,
    type: KIND_TO_TYPE[f.kind],
    sourcePage: f.page,
    title: (f.label || caption).slice(0, 80),
    caption,
    whyRelevant: "",
    placementAfterParagraph: afterParagraph,
  };
}

/**
 * Turns the writer's markers into `visual_assets`. Unknown IDs and repeats
 * (within the module) are dropped; `used` is shared across the module's lessons.
 */
export function placeFigures(
  content: string,
  figures: Map<string, FigureAsset>,
  used: Set<string>,
  assetPrefix: string
): { content: string; assets: LessonVisualAsset[]; dropped: string[] } {
  const { text, markers } = extractFigureMarkers(content);
  const assets: LessonVisualAsset[] = [];
  const dropped: string[] = [];
  for (const m of markers as FigureMarker[]) {
    const f = figures.get(m.id);
    if (!f || used.has(m.id)) {
      dropped.push(m.id);
      continue;
    }
    used.add(m.id);
    assets.push(toVisualAsset(f, cleanCaption(m.caption, f), m.afterParagraph, assetPrefix));
  }
  return { content: text, assets, dropped };
}

export const MAX_FIGURES_PER_LESSON = 3;

export type PlacedLesson = {
  content: string;
  firstPage: number;
  lastPage: number;
  assets: LessonVisualAsset[];
};

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4)
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/** Paragraphs before the figure: it goes after the paragraph sharing the most words with its page. */
function matchingParagraph(content: string, f: FigureAsset, caption: string, pageText: (g: number) => string): number {
  const paras = splitParagraphs(content);
  const target = words(`${pageText(f.g)} ${f.label} ${f.description} ${caption}`);
  let best = paras.length - 1;
  let bestScore = 0;
  paras.forEach((p, i) => {
    const s = overlap(words(p), target);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return Math.max(0, best + 1);
}

function sortAssets(lesson: PlacedLesson) {
  lesson.assets.sort((a, b) => (a.placementAfterParagraph ?? 0) - (b.placementAfterParagraph ?? 0));
}

/** The figures the writer listed for a lesson. Returns IDs that were unknown, repeated or over the cap. */
export function placeChosenFigures(
  lesson: PlacedLesson,
  chosen: Array<{ id: string; caption: string }>,
  figures: Map<string, FigureAsset>,
  used: Set<string>,
  pageText: (g: number) => string,
  assetPrefix: string
): string[] {
  const dropped: string[] = [];
  for (const c of chosen) {
    const id = c.id.trim().toUpperCase();
    const f = figures.get(id);
    if (!f || used.has(id) || lesson.assets.length >= MAX_FIGURES_PER_LESSON) {
      dropped.push(id);
      continue;
    }
    used.add(id);
    const caption = cleanCaption(c.caption, f);
    lesson.assets.push(toVisualAsset(f, caption, matchingParagraph(lesson.content, f, caption, pageText), assetPrefix));
  }
  sortAssets(lesson);
  return dropped;
}

/**
 * Places figures the writer left out: each goes into the lesson whose page
 * range holds its page. Figures with no lesson covering their page stay out.
 */
export function autoPlaceFigures(
  lessons: PlacedLesson[],
  figures: FigureAsset[],
  used: Set<string>,
  pageText: (g: number) => string,
  assetPrefix: string
): string[] {
  const placed: string[] = [];
  for (const f of [...figures].sort((a, b) => a.g - b.g)) {
    if (used.has(f.id)) continue;
    const lesson = lessons.find(
      (l) => f.g >= l.firstPage && f.g <= l.lastPage && l.assets.length < MAX_FIGURES_PER_LESSON
    );
    if (!lesson || splitParagraphs(lesson.content).length === 0) continue;
    used.add(f.id);
    lesson.assets.push(toVisualAsset(f, cleanCaption("", f), matchingParagraph(lesson.content, f, "", pageText), assetPrefix));
    placed.push(f.id);
  }
  for (const l of lessons) sortAssets(l);
  return placed;
}

/** Hamming distance between two equal-length hex hashes. */
function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Slides often repeat one picture; only its first appearance is kept. */
export function dropRepeatedImages<T extends { candidate: FigureCandidate }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of items) {
    const h = it.candidate.hash;
    const ar = it.candidate.width / Math.max(1, it.candidate.height);
    const dup =
      h &&
      kept.some((k) => {
        const kh = k.candidate.hash;
        const kar = k.candidate.width / Math.max(1, k.candidate.height);
        return kh && kh.length === h.length && Math.abs(Math.log(ar / kar)) < 0.1 && hashDistance(kh, h) <= 6;
      });
    if (!dup) kept.push(it);
  }
  return kept;
}
