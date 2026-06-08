import Anthropic from "@anthropic-ai/sdk";
import {
  isStripCropAspect,
  isTooSmallCrop,
} from "@/lib/pdf-ingest/filter-crop-quality";
import {
  cropPageDiagramFallback,
  cropPngToFigure,
  parseNormalizedBbox,
  type NormalizedFigureBbox,
} from "@/lib/study-ingest/source-images/crop-page-figure";
import { loadImage } from "@napi-rs/canvas";
import {
  pageFigureCropKey,
  pageTableKey,
} from "@/lib/study-ingest/source-images/page-table-keys";
import {
  isTableLikeCaption,
  shouldKeepFigureCaption,
} from "@/lib/pdf-ingest/filter-figure-caption";
import {
  bboxArea,
  isUsableCropQuality,
  maxFiguresPerPage,
  scoreCropQuality,
  shouldKeepCroppedFigure,
  shouldKeepVisionFigureHit,
} from "@/lib/pdf-ingest/filter-crop-quality";
import { sanitizeTableMarkdown } from "@/lib/study-ingest/table-text";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

export type PageTableExtraction = {
  key: string;
  sourceFileName: string;
  pageNum: number;
  markdown: string;
};

/** Diagram/figure/table crop metadata (URL attached after upload). */
export type PageFigureExtraction = {
  key: string;
  sourceFileName: string;
  pageNum: number;
  caption: string;
  figureIndex: number;
  bbox?: NormalizedFigureBbox;
  kind?: "table" | "figure";
};

function isTableExtractionEnabled(): boolean {
  const raw = process.env.PDF_INGEST_TABLE_VISION?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const TABLE_PROMPT = `You are extracting structured TABULAR DATA from a single page of a lecture PDF (often pharmacology, medicine, science, or technical courses).

If this page contains a table, matrix, or grid of values (drug names, doses, half-lives, MAC values, blood/gas partition coefficients, potency ratios, onset/duration, side-effects, contraindications, classification charts, etc.):

Output GitHub-flavored markdown table(s) ONLY:
- Header row + |---| separator + one row per data row
- Preserve EVERY number, unit, and proper noun EXACTLY as shown
- Keep mixed-language terms in full (e.g. 디아제팜(diazepam))
- Multiple tables on one page → separate tables with a blank line between
- Numeric ranges must use an en-dash between endpoints (2–3, 10–18) — never concatenate digits (wrong: 23, 1018)

If there is NO table or structured data grid on this page, output exactly the single word:
NONE

No commentary, no prose, no markdown fences.`;

const FIGURE_BBOX_PROMPT = `You are analyzing a single page from a lecture PDF (often pharmacology or medicine slides).

Find each distinct DIAGRAM, CHART, FLOWCHART, ANNOTATED ILLUSTRATION, INSTITUTIONAL LOGO/SEAL, or ANATOMICAL FIGURE on this page.
Include: org seals, mechanism diagrams, labeled photos, process flowcharts, comparison charts.
Do NOT include: slide title bars alone, footers, page numbers, or pure bullet-text-only regions (no diagram).

Output ONLY valid JSON (no markdown fences):
{"figures":[{"caption":"short label in the slide language","bbox":[ymin,xmin,ymax,xmax]}]}

bbox uses 0–1000 scale with origin at top-left: ymin,xmin,ymax,xmax.
Draw a box around each figure INCLUDING all labels, arrows, legend, and footer text.
Add ~3% margin on every side; extra margin below so nothing is clipped.
Multiple figures → multiple entries. If none: {"figures":[]}`;

const UNIFIED_PAGE_PROMPT = `Analyze this single page from a lecture PDF (pharmacology, medicine, science slides).

Return ONLY valid JSON (no markdown fences):
{
  "tables": [],
  "figures": [{"caption":"short label in slide language","bbox":[ymin,xmin,ymax,xmax]}],
  "tableText": null
}

figures ONLY when the page has a REAL illustration: anatomy drawing, organ diagram, mechanism flowchart with arrows between labeled shapes, chemical structure, labeled photo.
NEVER bbox: ANY data table or grid (including anesthesia stage tables with columns like 단계/작용부위/의식/호흡, drug classification tables, comparison tables, 표 N headers), bar/column charts of categories, bullet lists, paragraph text, title bars, icon/symbol columns, checkbox grids, or narrow vertical strips.
tableText: if the page has ANY data table/grid (including 표 N drug tables, potency charts, side-effect matrices, seizure-type mappings, MAC/partition tables), output GitHub-flavored markdown (header + |---| + one row per source row). Multiple tables on one page → separate tables with a blank line. Preserve every number, range (use en-dash: 2–3 not 23), and drug name exactly. null only when there is truly no tabular grid.
Leave "tables" as an empty array — tabular data must NOT be cropped as images.
bbox uses 0–1000 scale, origin top-left: ymin,xmin,ymax,xmax.
Up to THREE separate figure bboxes when the page has multiple distinct diagrams.
If the page has BOTH a data table AND a diagram, bbox ONLY the diagram — never the table grid.
Minimum diagram box area ~6% of page. NEVER bbox the entire page.
Include ~5% padding on ALL sides (especially right and bottom) so columns and footer rows are never cut off.
If unsure whether a region is a table or diagram, do NOT bbox it.`;

export type VisionTableHit = {
  caption: string;
  bbox: NormalizedFigureBbox;
};

export type UnifiedPageVisionResult = {
  tables: VisionTableHit[];
  figures: VisionFigureHit[];
  /** GFM for chunk indexing only — never shown to students as markdown. */
  tableText: string | null;
};

function visionModel(): string {
  return (
    process.env.PDF_INGEST_VISION_MODEL?.trim() ||
    process.env.ANTHROPIC_FAST_MODEL?.trim() ||
    "claude-haiku-4-5"
  );
}

function parseVisionHits(raw: unknown, strict = true): VisionFigureHit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const o = row as Record<string, unknown>;
    const caption = typeof o.caption === "string" ? o.caption.trim() : "";
    const bbox = parseNormalizedBbox(o.bbox);
    if (caption.length < 2 || !bbox) return [];
    if (!shouldKeepFigureCaption(caption)) return [];
    if (isTableLikeCaption(caption)) return [];
    if (strict && !shouldKeepVisionFigureHit({ caption, bbox })) return [];
    return [{ caption, bbox }];
  });
}

type ScoredCrop = {
  buffer: Buffer;
  caption: string;
  bbox: NormalizedFigureBbox;
  quality: number;
};

/** Try vision bboxes (and fallback band) — keep highest-quality non-☒ crops. */
async function pickFigureCropsForPage(input: {
  pagePng: Buffer;
  pageNum: number;
  hits: VisionFigureHit[];
  maxKeep: number;
}): Promise<ScoredCrop[]> {
  const candidates: ScoredCrop[] = [];
  const seenSig = new Set<string>();

  const tryCrop = async (
    buffer: Buffer | null,
    caption: string,
    bbox: NormalizedFigureBbox
  ) => {
    if (!buffer) return;
    const sig = `${bbox.ymin}:${bbox.xmin}:${bbox.ymax}:${bbox.xmax}:${buffer.length}`;
    if (seenSig.has(sig)) return;
    seenSig.add(sig);

    const relaxed = bbox.ymax - bbox.ymin >= 700;
    if (
      !(await shouldKeepCroppedFigure({
        buffer,
        caption,
        bbox,
        relaxedBbox: relaxed,
      }))
    ) {
      return;
    }
    try {
      const image = await loadImage(buffer);
      if (
        isStripCropAspect(image.width, image.height) ||
        isTooSmallCrop(image.width, image.height)
      ) {
        return;
      }
    } catch {
      return;
    }
    const quality = await scoreCropQuality(buffer);
    if (!isUsableCropQuality(quality)) return;
    candidates.push({ buffer, caption, bbox, quality });
  };

  const sortedHits = [...input.hits].sort(
    (a, b) => bboxArea(b.bbox) - bboxArea(a.bbox)
  );

  for (const hit of sortedHits) {
    const cropped = await cropPngToFigure(input.pagePng, hit.bbox);
    await tryCrop(cropped, hit.caption, hit.bbox);
  }

  if (candidates.length === 0) {
    const fallback = await cropPageDiagramFallback(input.pagePng);
    const fallbackBbox: NormalizedFigureBbox = {
      ymin: 110,
      xmin: 40,
      ymax: 910,
      xmax: 960,
    };
    await tryCrop(
      fallback,
      `Diagram page ${input.pageNum}`,
      fallbackBbox
    );
  }

  candidates.sort((a, b) => b.quality - a.quality);
  return candidates.slice(0, input.maxKeep);
}

function parseUnifiedVisionJson(raw: string): UnifiedPageVisionResult {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  try {
    const parsed = JSON.parse(text) as {
      tables?: unknown;
      figures?: unknown;
      tableText?: unknown;
    };
    let tableText: string | null = null;
    if (typeof parsed.tableText === "string") {
      const t = parsed.tableText.trim();
      if (t && t.toLowerCase() !== "null" && t.includes("|") && t.length >= 12) {
        tableText = t;
      }
    }
    // Legacy: model returned markdown string in "tables" field
    if (!tableText && typeof parsed.tables === "string") {
      const t = parsed.tables.trim();
      if (t && t.toLowerCase() !== "null" && t.includes("|") && t.length >= 12) {
        tableText = t;
      }
    }
    const tables =
      typeof parsed.tables === "string" ? [] : parseVisionHits(parsed.tables);
    const figures = parseVisionHits(parsed.figures, false);
    return { tables, figures, tableText };
  } catch {
    return { tables: [], figures: [], tableText: null };
  }
}

/**
 * Single vision call per page: tables + figure bboxes/captions.
 */
export async function extractPageArtifactsFromPdfPagePng(input: {
  buffer: Buffer;
  pageNum: number;
  sourceFileName: string;
}): Promise<UnifiedPageVisionResult> {
  const empty: UnifiedPageVisionResult = { tables: [], figures: [], tableText: null };
  if (!isTableExtractionEnabled()) return empty;
  if (!input.buffer || input.buffer.length < 4_000) return empty;

  const apiKey = process.env.ANTHROPIC_API_KEY!.trim();
  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });

  const msg = await anthropic.messages.create({
    model: visionModel(),
    max_tokens: 4096,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: input.buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `${UNIFIED_PAGE_PROMPT}\n\nFILE: ${input.sourceFileName}\nPAGE: ${input.pageNum}`,
          },
        ],
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "text");
  const raw = block?.type === "text" ? block.text.trim() : "";
  if (!raw) return empty;
  return parseUnifiedVisionJson(raw);
}

/**
 * Vision pass: pull markdown tables from a rendered PDF page PNG so lesson
 * generation receives numeric/tabular data that text extraction often misses.
 */
export async function extractTablesFromPdfPagePng(input: {
  buffer: Buffer;
  pageNum: number;
  sourceFileName: string;
}): Promise<string | null> {
  if (!isTableExtractionEnabled()) return null;
  if (!input.buffer || input.buffer.length < 4_000) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY!.trim();
  const model =
    process.env.ANTHROPIC_FAST_MODEL?.trim() || "claude-haiku-4-5";
  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });

  const msg = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: input.buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `${TABLE_PROMPT}\n\nFILE: ${input.sourceFileName}\nPAGE: ${input.pageNum}`,
          },
        ],
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "text");
  const raw = block?.type === "text" ? block.text.trim() : "";
  if (!raw || raw.toUpperCase() === "NONE" || raw.length < 12) return null;
  if (!raw.includes("|")) return null;
  return raw;
}

type VisionFigureHit = { caption: string; bbox: NormalizedFigureBbox };

function parseFigureVisionJson(raw: string): VisionFigureHit[] {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  try {
    const parsed = JSON.parse(text) as { figures?: unknown };
    if (!Array.isArray(parsed.figures)) return [];
    const out: VisionFigureHit[] = [];
    for (const row of parsed.figures) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const caption =
        typeof o.caption === "string" ? o.caption.trim() : "";
      const bbox = parseNormalizedBbox(o.bbox);
      if (caption.length < 3 || !bbox) continue;
      out.push({ caption, bbox });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Vision pass: detect diagram bounding boxes + captions on a page PNG.
 */
export async function extractFigureBboxesFromPdfPagePng(input: {
  buffer: Buffer;
  pageNum: number;
  sourceFileName: string;
}): Promise<VisionFigureHit[]> {
  if (!isTableExtractionEnabled()) return [];
  if (!input.buffer || input.buffer.length < 4_000) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY!.trim();
  const model =
    process.env.ANTHROPIC_FAST_MODEL?.trim() || "claude-haiku-4-5";
  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });

  const msg = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: input.buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `${FIGURE_BBOX_PROMPT}\n\nFILE: ${input.sourceFileName}\nPAGE: ${input.pageNum}`,
          },
        ],
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "text");
  const raw = block?.type === "text" ? block.text.trim() : "";
  if (!raw) return [];
  return parseFigureVisionJson(raw);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Run vision table extraction on freshly rendered PDF page PNGs (buffers
 * still in memory from renderPdfPagesToPng).
 */
export type PageArtifactsExtractResult = {
  pageTableExtractions: PageTableExtraction[];
  cropImages: RawSourceImage[];
  pageFigureExtractions: PageFigureExtraction[];
};

/**
 * One vision call per page → tables + figure crops (replaces separate passes).
 */
export async function extractPageArtifactsFromRenderedPdfPages(
  rendered: RawSourceImage[],
  opts?: { jobId?: string; skipPageNumbers?: Set<number> }
): Promise<PageArtifactsExtractResult> {
  const empty: PageArtifactsExtractResult = {
    pageTableExtractions: [],
    cropImages: [],
    pageFigureExtractions: [],
  };
  if (!isTableExtractionEnabled() || rendered.length === 0) return empty;

  const skipFiguresOn = opts?.skipPageNumbers;
  const pageRenders = rendered.filter(
    (r) => r.anchorType === "page" && r.anchorIndex > 0
  );
  if (pageRenders.length === 0) return empty;

  const concurrency = Math.min(
    12,
    Math.max(
      1,
      Number.parseInt(process.env.PDF_INGEST_TABLE_VISION_CONCURRENCY ?? "8", 10) ||
        8
    )
  );

  const pageTableExtractions: PageTableExtraction[] = [];
  const cropImages: RawSourceImage[] = [];
  const pageFigureExtractions: PageFigureExtraction[] = [];

  await mapWithConcurrency(pageRenders, concurrency, async (img) => {
    try {
      const unified = await extractPageArtifactsFromPdfPagePng({
        buffer: img.buffer,
        pageNum: img.anchorIndex,
        sourceFileName: img.sourceFileName,
      });
      const pageHasTable =
        Boolean(unified.tableText) &&
        unified.tableText!.includes("|") &&
        unified.tableText!.split("\n").filter((l) => l.includes("|")).length >=
          3;

      if (pageHasTable) {
        pageTableExtractions.push({
          key: pageTableKey(img.sourceFileName, img.anchorIndex),
          sourceFileName: img.sourceFileName,
          pageNum: img.anchorIndex,
          markdown: unified.tableText!,
        });
      }
      if (skipFiguresOn?.has(img.anchorIndex)) return null;

      const figureHits = unified.figures.filter(
        (hit) =>
          shouldKeepFigureCaption(hit.caption) &&
          !isTableLikeCaption(hit.caption)
      );

      const picked = await pickFigureCropsForPage({
        pagePng: img.buffer,
        pageNum: img.anchorIndex,
        hits: figureHits,
        maxKeep: maxFiguresPerPage(),
      });

      for (let fi = 0; fi < picked.length; fi++) {
        const row = picked[fi]!;
        const key = pageFigureCropKey(img.sourceFileName, img.anchorIndex, fi);
        cropImages.push({
          buffer: row.buffer,
          mimeType: "image/png",
          fileName: `page-${img.anchorIndex}-fig-${fi + 1}.png`,
          sourceFileName: img.sourceFileName,
          label: row.caption,
          anchorType: "page",
          anchorIndex: img.anchorIndex,
        });
        pageFigureExtractions.push({
          key,
          sourceFileName: img.sourceFileName,
          pageNum: img.anchorIndex,
          caption: row.caption,
          figureIndex: fi,
          bbox: row.bbox,
          kind: "figure",
        });
      }
    } catch (e) {
      console.warn(
        "[extractPageArtifactsFromRenderedPdfPages] page",
        img.anchorIndex,
        e
      );
    }
    return null;
  });

  if (pageTableExtractions.length > 0 || pageFigureExtractions.length > 0) {
    console.info("[extractPageArtifactsFromRenderedPdfPages]", {
      jobId: opts?.jobId,
      pagesScanned: pageRenders.length,
      tablesFound: pageTableExtractions.length,
      figuresCropped: pageFigureExtractions.length,
    });
  }
  return { pageTableExtractions, cropImages, pageFigureExtractions };
}

/** @deprecated Use extractPageArtifactsFromRenderedPdfPages */
export async function extractTablesFromRenderedPdfPages(
  rendered: RawSourceImage[],
  opts?: { jobId?: string }
): Promise<PageTableExtraction[]> {
  const { pageTableExtractions } = await extractPageArtifactsFromRenderedPdfPages(
    rendered,
    opts
  );
  return pageTableExtractions;
}

export function pageTableExtractionsToMap(
  extractions: PageTableExtraction[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of extractions) {
    const md = sanitizeTableMarkdown(e.markdown);
    if (md) map.set(e.key, md);
  }
  return map;
}

export type CroppedFigureExtractResult = {
  /** Cropped PNGs ready to upload (preferred for lesson embed). */
  cropImages: RawSourceImage[];
  extractions: PageFigureExtraction[];
};

/**
 * Vision + crop: detect diagram bboxes, return cropped PNG buffers per figure.
 */
export async function extractAndCropFiguresFromRenderedPdfPages(
  rendered: RawSourceImage[],
  opts?: { jobId?: string; skipPageNumbers?: Set<number> }
): Promise<CroppedFigureExtractResult> {
  const { cropImages, pageFigureExtractions } =
    await extractPageArtifactsFromRenderedPdfPages(rendered, opts);
  return { cropImages, extractions: pageFigureExtractions };
}

/** @deprecated Use extractAndCropFiguresFromRenderedPdfPages */
export async function extractFiguresFromRenderedPdfPages(
  rendered: RawSourceImage[],
  opts?: { jobId?: string }
): Promise<PageFigureExtraction[]> {
  const { extractions } = await extractAndCropFiguresFromRenderedPdfPages(
    rendered,
    opts
  );
  return extractions;
}
