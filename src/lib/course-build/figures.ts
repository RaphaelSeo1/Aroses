import type { LessonVisualAsset, LessonVisualAssetType } from "@/types/course";
import { extractFigureMarkers, splitParagraphs, type FigureMarker } from "./figure-markers.ts";
import { matchTokens } from "./language.ts";
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
  /** Pages whose text-layer tables vision was asked about, and those it found no table on. */
  tablePages?: { checked: number[]; demoted: number[] };
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

const CAPTION_RE =
  /^\s*((fig(?:ure|ura)?|table|chart|diagram|exhibit|tabla|tableau|tabelle|tabella|tabela|abbildung|abb|gráfico|grafico|şekil|gambar|tabel|hình|bảng|рис(?:унок)?|таблица|चित्र|तालिका|شكل|جدول|그림|표|도표|図|表|图|圖)\s*\.?\s*\d+[a-z]?)\s*[.:)\-–]?\s*(.*)$/iu;

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
    out.push({ text: line.slice(0, 160), table: /^(table|tabla|tableau|tabelle|tabella|tabela|tabel|bảng|таблица|तालिका|جدول|표|도표|表)/iu.test(m[2]) });
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

/**
 * Same-page crops that share this much of the smaller box are one figure.
 * Lecture files often store one photo as overlapping slices; 0.6 let those through.
 */
const SAME_PAGE_COVER = 0.4;

/** Drops crops mostly inside a better one on the same page. */
export function dedupe(cands: FigureCandidate[]): FigureCandidate[] {
  const byQuality = cands.slice().sort((a, b) => b.quality - a.quality || area(b.box) - area(a.box));
  const kept: FigureCandidate[] = [];
  for (const c of byQuality) {
    const covered = kept.some(
      (k) => k.page === c.page && intersection(k.box, c.box) > SAME_PAGE_COVER * Math.min(area(k.box), area(c.box))
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

/** One line per figure for the writer: about 20 tokens each. Descriptions the page text doesn't back up are left out. */
export function figureManifest(figures: FigureAsset[], pageText = ""): string {
  return figures
    .map((f) => {
      const description = f.description && confirmedBy(f.description, `${pageText} ${f.label}`) ? f.description : "";
      const bits = [f.label && `"${f.label}"`, description].filter(Boolean).join(" — ");
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

/** Words that say what kind of picture it is, not what it shows. */
const GENERIC_WORDS = new Set(
  "diagram diagrams chart charts graph graphs table tables image images figure figures photo picture illustration showing shows shown labeled labelled multiple various including example examples with their between from this that these into data 그림 도표 사진 도식 図表 写真 画像 图表 图片 示意 圖表 圖片".split(
    " "
  )
);

function contentStems(text: string): string[] {
  return matchTokens(text, GENERIC_WORDS);
}

/** At least half the caption's meaningful words appear in the source text. */
export function confirmedBy(caption: string, sourceText: string): boolean {
  const words = contentStems(caption);
  if (words.length === 0) return false;
  const source = new Set(contentStems(sourceText));
  const hits = words.filter((w) => source.has(w)).length;
  return hits >= Math.ceil(words.length / 2);
}

/** "Figure 14-2 part 1" names a figure; "Figure 3. Lipid bilayer" describes it. */
function descriptiveLabel(label: string): boolean {
  const rest = label.replace(CAPTION_RE, "$3").replace(/^[\d\s.\-–:)]*(part\s*\d+)?/i, "");
  return contentStems(rest).length >= 2;
}

export type CaptionOptions = {
  /** The course is in a different language from the files. */
  converting?: boolean;
  /** Neutral caption in the course's language, for figures nothing names. */
  fromPage?: (page: number) => string;
};

/** Every number in the caption appears in the source. */
function numbersBacked(caption: string, sourceText: string): boolean {
  const have = new Set(sourceText.match(/\d+(?:[.,]\d+)?/g) ?? []);
  return (caption.match(/\d+(?:[.,]\d+)?/g) ?? []).every((n) => have.has(n));
}

function unbalanced(text: string): boolean {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return count(/\(/g) !== count(/\)/g) || count(/\[/g) !== count(/\]/g);
}

/**
 * A caption cut off mid-sentence: it ends on a comma, dash or open bracket,
 * on a short lower-case word ("occurs on", "in the"), or the page carries
 * the sentence on past it ("The chromatin in human" + "chromosomes is …").
 */
export function truncatedCaption(caption: string, pageText = ""): boolean {
  const c = caption.replace(/\s+/g, " ").trim();
  if (!c) return false;
  if (/(?:[,;:(\[{/&\-–—…]|\.\.\.)$/u.test(c) || unbalanced(c)) return true;
  if (/[.!?。！？؟)\]"'”’]$/u.test(c)) return false;
  // A unit after a number ("50 nm") is a complete label, not a cut-off word.
  if (/(?:^|[^\p{N}\s]\s)\p{Ll}{1,3}$/u.test(c)) return true;
  const page = pageText.replace(/\s+/g, " ");
  const at = page.indexOf(c);
  return at >= 0 && /^ ?\p{Ll}/u.test(page.slice(at + c.length, at + c.length + 3));
}

/**
 * The source's own caption wins. Otherwise the writer's caption, then the
 * vision description, but only when the page text backs its words up; a
 * caption nothing confirms is dropped rather than risk naming the wrong thing.
 * A caption cut off mid-sentence never shows; the neutral "from page N"
 * does instead.
 *
 * When converting to another language the source's words can't be shown and
 * can't be compared, so the writer's caption is kept only if the writer was
 * given something confirmed to translate (a descriptive source caption or a
 * backed-up vision description) and its numbers match.
 */
export function figureCaption(f: FigureAsset, writerCaption: string, pageText: string, opts: CaptionOptions = {}): string {
  const writer = writerCaption.replace(/\s+/g, " ").trim().slice(0, 200);
  const source = `${pageText} ${f.label}`;
  const whole = (t: string) => Boolean(t) && !truncatedCaption(t, pageText);
  const label = whole(f.label) ? f.label : "";
  if (opts.converting) {
    const labelled = Boolean(label && descriptiveLabel(label));
    const described = Boolean(f.description && confirmedBy(f.description, source));
    return whole(writer) && (labelled || described) && numbersBacked(writer, `${source} ${f.description}`) ? writer : "";
  }
  if (label && descriptiveLabel(label)) return label;
  if (whole(writer) && confirmedBy(writer, source) && agreesWithPicture(writer, f.description)) return writer;
  if (whole(f.description) && confirmedBy(f.description, source)) return f.description;
  return label;
}

/**
 * A page can print captions for other figures than the one cropped (a
 * textbook scan behind a slide's own photos), so page text alone doesn't
 * prove a caption fits this picture. When the vision check said what the
 * picture shows, the caption must name at least one of those things.
 */
function agreesWithPicture(caption: string, description: string | undefined): boolean {
  const seen = contentStems(description ?? "");
  if (seen.length === 0) return true;
  const named = new Set(contentStems(caption));
  return seen.some((w) => named.has(w));
}

function toVisualAsset(
  f: FigureAsset,
  caption: string,
  afterParagraph: number,
  assetPrefix: string,
  opts: CaptionOptions
): LessonVisualAsset {
  const shown = caption || opts.fromPage?.(f.page) || "";
  return {
    assetId: `${assetPrefix}${f.id}`,
    imageUrl: f.url,
    type: KIND_TO_TYPE[f.kind],
    sourcePage: f.page,
    title: shown.slice(0, 80),
    caption: shown,
    whyRelevant: "",
    placementAfterParagraph: afterParagraph,
  };
}

/** A lesson's own source pages, as the writer gave them. */
export type PageRange = { first: number; last: number };

/** True when the range is unknown, or holds page `g`. */
function onPages(range: PageRange | undefined, g: number): boolean {
  if (!range || !(range.first > 0) || !(range.last >= range.first)) return true;
  return g >= range.first && g <= range.last;
}

/**
 * Turns the writer's markers into `visual_assets`. Unknown IDs and repeats
 * (within the module) are dropped; `used` is shared across the module's
 * lessons. A figure from a page outside the lesson's `range` isn't placed
 * here (`offPage`): it goes to the lesson that teaches its page, if any.
 */
export function placeFigures(
  content: string,
  figures: Map<string, FigureAsset>,
  used: Set<string>,
  pageText: (g: number) => string,
  assetPrefix: string,
  opts: CaptionOptions = {},
  range?: PageRange
): { content: string; assets: LessonVisualAsset[]; dropped: string[]; offPage: string[] } {
  const { text, markers } = extractFigureMarkers(content);
  const assets: LessonVisualAsset[] = [];
  const dropped: string[] = [];
  const offPage: string[] = [];
  for (const m of markers as FigureMarker[]) {
    const f = figures.get(m.id);
    if (!f || used.has(m.id)) {
      dropped.push(m.id);
      continue;
    }
    if (!onPages(range, f.g)) {
      offPage.push(m.id);
      continue;
    }
    used.add(m.id);
    assets.push(toVisualAsset(f, figureCaption(f, m.caption, pageText(f.g), opts), m.afterParagraph, assetPrefix, opts));
  }
  return { content: text, assets, dropped, offPage };
}

export const MAX_FIGURES_PER_LESSON = 3;

export type PlacedLesson = {
  content: string;
  firstPage: number;
  lastPage: number;
  assets: LessonVisualAsset[];
};

function words(text: string): Set<string> {
  return new Set(matchTokens(text));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/**
 * Paragraphs before the figure: it goes after the free paragraph sharing the
 * most words with its page, one figure per paragraph. With no word overlap it
 * goes where its page falls in the lesson's page range. Null when every
 * paragraph already has a figure.
 */
function matchingParagraph(lesson: PlacedLesson, f: FigureAsset, caption: string, pageText: (g: number) => string): number | null {
  const paras = splitParagraphs(lesson.content);
  const taken = new Set(lesson.assets.map((a) => a.placementAfterParagraph ?? 0));
  const free = paras.map((_, i) => i).filter((i) => !taken.has(i + 1));
  if (free.length === 0) return null;
  const target = words(`${pageText(f.g)} ${f.label} ${caption}`);
  let best = -1;
  let bestScore = 0;
  for (const i of free) {
    const s = overlap(words(paras[i]!), target);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  if (best < 0) {
    const span = Math.max(1, lesson.lastPage - lesson.firstPage + 1);
    const want = Math.min(paras.length - 1, Math.floor(((f.g - lesson.firstPage) / span) * paras.length));
    best = free.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  }
  return best + 1;
}

function sortAssets(lesson: PlacedLesson) {
  lesson.assets.sort((a, b) => (a.placementAfterParagraph ?? 0) - (b.placementAfterParagraph ?? 0));
}

/**
 * The figures the writer listed for a lesson. Returns IDs that were unknown,
 * repeated, over the cap or left without a free paragraph. A figure from a
 * page outside the lesson's page range is left unplaced (and not returned),
 * for the lesson that teaches its page.
 */
export function placeChosenFigures(
  lesson: PlacedLesson,
  chosen: Array<{ id: string; caption: string }>,
  figures: Map<string, FigureAsset>,
  used: Set<string>,
  pageText: (g: number) => string,
  assetPrefix: string,
  opts: CaptionOptions = {}
): string[] {
  const dropped: string[] = [];
  for (const c of chosen) {
    const id = c.id.trim().toUpperCase();
    const f = figures.get(id);
    if (f && !used.has(id) && !onPages({ first: lesson.firstPage, last: lesson.lastPage }, f.g)) continue;
    if (!f || used.has(id) || lesson.assets.length >= MAX_FIGURES_PER_LESSON) {
      dropped.push(id);
      continue;
    }
    const caption = figureCaption(f, c.caption, pageText(f.g), opts);
    const after = matchingParagraph(lesson, f, caption, pageText);
    if (after == null) {
      dropped.push(id);
      continue;
    }
    used.add(id);
    lesson.assets.push(toVisualAsset(f, caption, after, assetPrefix, opts));
  }
  sortAssets(lesson);
  return dropped;
}

/**
 * Places figures the writer left out: each goes into the lesson whose source
 * pages hold its page. `sourcePages` (one per lesson) are the pages the
 * writer said each lesson draws on, which may be narrower than the ranges
 * stretched to cover the module; without it the lesson ranges count.
 * Figures with no lesson on their page stay out.
 */
export function autoPlaceFigures(
  lessons: PlacedLesson[],
  figures: FigureAsset[],
  used: Set<string>,
  pageText: (g: number) => string,
  assetPrefix: string,
  opts: CaptionOptions = {},
  sourcePages?: PageRange[]
): string[] {
  const placed: string[] = [];
  const rangeOf = (i: number): PageRange => {
    const r = sourcePages?.[i];
    return r && r.first > 0 && r.last >= r.first ? r : { first: lessons[i]!.firstPage, last: lessons[i]!.lastPage };
  };
  for (const f of [...figures].sort((a, b) => a.g - b.g)) {
    if (used.has(f.id)) continue;
    // The narrowest range wins: a lesson stretched over pages it skipped yields to one written for the page.
    let lesson: PlacedLesson | undefined;
    let span = Infinity;
    lessons.forEach((l, i) => {
      const r = rangeOf(i);
      if (f.g < r.first || f.g > r.last || l.assets.length >= MAX_FIGURES_PER_LESSON) return;
      if (r.last - r.first < span) {
        lesson = l;
        span = r.last - r.first;
      }
    });
    if (!lesson) continue;
    const caption = figureCaption(f, "", pageText(f.g), opts);
    const after = matchingParagraph(lesson, f, caption, pageText);
    if (after == null) continue;
    used.add(f.id);
    lesson.assets.push(toVisualAsset(f, caption, after, assetPrefix, opts));
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

/**
 * Slides often repeat one picture; only its first appearance is kept.
 * On one page the same photo is also sliced into different shapes, so aspect
 * ratio is ignored and the larger slice wins.
 */
export function dropRepeatedImages<T extends { candidate: FigureCandidate }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of items) {
    const h = it.candidate.hash;
    const ar = it.candidate.width / Math.max(1, it.candidate.height);
    const dupAt =
      h == null
        ? -1
        : kept.findIndex((k) => {
            const kh = k.candidate.hash;
            if (!kh || kh.length !== h.length || hashDistance(kh, h) > 6) return false;
            if (k.candidate.page === it.candidate.page) return true;
            const kar = k.candidate.width / Math.max(1, k.candidate.height);
            return Math.abs(Math.log(ar / kar)) < 0.1;
          });
    if (dupAt < 0) {
      kept.push(it);
      continue;
    }
    const prev = kept[dupAt]!;
    if (prev.candidate.page === it.candidate.page && area(it.candidate.box) > area(prev.candidate.box)) {
      kept[dupAt] = it;
    }
  }
  return kept;
}
