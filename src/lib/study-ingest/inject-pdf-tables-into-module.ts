import type { CourseStructurePlan } from "@/lib/ai/course-payload";
import { lessonMarkdownHasImages } from "@/lib/lesson-content-layout";
import type { PersistedIngestChunk } from "@/lib/source-attribution";
import { parsePageNumbersFromPosition } from "@/lib/study-ingest/chunk-position";
import {
  pageFigureCropKey,
  pageTableCropKey,
  pageTableKey,
} from "@/lib/study-ingest/source-images/page-table-keys";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import { isFullPageRenderImage } from "@/lib/study-ingest/source-images/is-page-render";
import {
  cosineSimilarity,
  embedText,
} from "@/lib/embeddings/text-similarity";
import type {
  CourseAsset,
  CourseAssetManifest,
} from "@/lib/study-ingest/course-assets";
import type { CourseModule } from "@/types/course";

function filesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Parse `pages 5–6`, `pages 7-8`, `page 3` from lesson source locators. */
export function parsePagesFromSourceLocator(locator: string): number[] {
  const t = locator.trim();
  const range = t.match(/\bpages?\s+(\d+)\s*[–-]\s*(\d+)\b/i);
  if (range) {
    const start = Number.parseInt(range[1]!, 10);
    const end = Number.parseInt(range[2]!, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const pages: number[] = [];
    for (let p = lo; p <= hi; p++) pages.push(p);
    return pages;
  }
  const single = t.match(/\bpage\s+~?(\d+)\b/i);
  if (single) {
    const n = Number.parseInt(single[1]!, 10);
    return Number.isFinite(n) ? [n] : [];
  }
  return [];
}

/** Merge uploaded ingest images with persisted page-artifact figures. */
export function mergeIngestPageImageRecords(
  sourceImages: IngestSourceImageRecord[],
  artifacts: IngestPageArtifacts
): IngestSourceImageRecord[] {
  const out: IngestSourceImageRecord[] = [];
  const seen = new Set<string>();
  const push = (img: IngestSourceImageRecord) => {
    const k = `${img.sourceFileName.trim().toLowerCase()}:p${img.anchorIndex}:${img.url}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(img);
  };
  for (const img of sourceImages) {
    if (isFullPageRenderImage(img)) continue;
    push(img);
  }
  for (const fig of artifacts.figures) {
    push({
      id: fig.key,
      url: fig.url,
      sourceFileName: fig.sourceFileName,
      label: fig.caption,
      anchorType: "page",
      anchorIndex: fig.pageNum,
      mimeType: "image/png",
    });
  }
  return out;
}

/** One cropped visual from the upload (figure or table screenshot). */
export type IngestPageFigure = {
  key: string;
  sourceFileName: string;
  pageNum: number;
  url: string;
  caption: string;
  kind?: "table" | "figure";
};

export type IngestPageArtifacts = {
  tables: Record<string, string>;
  figures: IngestPageFigure[];
};

export function emptyIngestPageArtifacts(): IngestPageArtifacts {
  return { tables: {}, figures: [] };
}

function isFullPageFallbackLabel(label: string): boolean {
  return isFullPageRenderImage({ label });
}

/** Prefer vision-cropped diagram PNGs over full-page screenshots. */
export function pageFiguresFromSourceImages(
  images: IngestSourceImageRecord[]
): IngestPageFigure[] {
  const byPage = new Map<string, IngestSourceImageRecord[]>();
  for (const img of images) {
    if (img.anchorType !== "page" || img.anchorIndex <= 0 || !img.url) continue;
    const k = pageTableKey(img.sourceFileName, img.anchorIndex);
    const arr = byPage.get(k) ?? [];
    arr.push(img);
    byPage.set(k, arr);
  }

  const out: IngestPageFigure[] = [];
  for (const [, imgs] of byPage) {
    let crops = imgs.filter((i) => !isFullPageFallbackLabel(i.label ?? ""));
    if (crops.length === 0) {
      crops = imgs.filter((i) =>
        /snapshot/i.test(i.label ?? "")
      );
    }
    let fi = 0;
    for (const img of crops) {
      const isTable =
        (img.label ?? "").trim().toLowerCase().startsWith("table:") ||
        (img.label ?? "").toLowerCase().includes("table");
      const caption =
        img.label?.replace(/^Table:\s*/i, "").trim() ||
        (isTable
          ? `Table from page ${img.anchorIndex}`
          : `Diagram from page ${img.anchorIndex}`);
      out.push({
        key: isTable
          ? pageTableCropKey(img.sourceFileName, img.anchorIndex, fi)
          : pageFigureCropKey(img.sourceFileName, img.anchorIndex, fi),
        sourceFileName: img.sourceFileName,
        pageNum: img.anchorIndex,
        url: img.url,
        caption,
        kind: isTable ? "table" : "figure",
      });
      fi++;
    }
  }
  return out;
}

function imagesForLessonPage(
  sourceImages: IngestSourceImageRecord[],
  fileName: string,
  pageNum: number
): IngestSourceImageRecord[] {
  const candidates = sourceImages.filter(
    (i) =>
      filesMatch(i.sourceFileName, fileName) &&
      i.anchorType === "page" &&
      i.anchorIndex === pageNum &&
      i.url
  );
  const crops = candidates.filter((i) => !isFullPageFallbackLabel(i.label ?? ""));
  return crops;
}

export function serializeIngestPageArtifacts(
  input: {
    tables: Map<string, string>;
    figures: IngestPageFigure[];
  }
): IngestPageArtifacts {
  return {
    tables: Object.fromEntries(input.tables),
    figures: input.figures,
  };
}

/** Back-compat: flat string map OR `{ tables, figures }` jsonb. */
export function parseIngestPageArtifacts(raw: unknown): IngestPageArtifacts {
  if (!raw || typeof raw !== "object") return emptyIngestPageArtifacts();
  const o = raw as Record<string, unknown>;

  if (o.tables && typeof o.tables === "object") {
    const tables: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.tables as Record<string, unknown>)) {
      if (typeof v === "string" && v.includes("|")) tables[k] = v;
    }
    const figures: IngestPageFigure[] = [];
    if (Array.isArray(o.figures)) {
      for (const row of o.figures) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const url = typeof r.url === "string" ? r.url.trim() : "";
        const pageNum =
          typeof r.pageNum === "number" && Number.isFinite(r.pageNum)
            ? r.pageNum
            : 0;
        const sourceFileName =
          typeof r.sourceFileName === "string" ? r.sourceFileName.trim() : "";
        const key =
          typeof r.key === "string"
            ? r.key
            : pageTableKey(sourceFileName || "upload.pdf", pageNum);
        const caption =
          typeof r.caption === "string" ? r.caption.trim() : "";
        if (url && pageNum > 0) {
          figures.push({
            key,
            sourceFileName: sourceFileName || "upload.pdf",
            pageNum,
            url,
            caption: caption || `Diagram from page ${pageNum}`,
          });
        }
      }
    }
    return { tables, figures };
  }

  const tables: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && v.includes("|")) tables[k] = v;
  }
  return { tables, figures: [] };
}

export function parsePageTablesMap(raw: unknown): Map<string, string> {
  const { tables } = parseIngestPageArtifacts(raw);
  return new Map(Object.entries(tables));
}

export function serializePageTablesMap(
  map: Map<string, string>
): Record<string, string> {
  return Object.fromEntries(map);
}

/** Pull table markdown blocks embedded in module source text (pre-truncation). */
export function extractPdfTableBlocksFromSource(sourceText: string): string[] {
  if (!sourceText.includes("TABLES FROM ORIGINAL PDF")) return [];
  const parts = sourceText.split(
    /--- TABLES FROM ORIGINAL PDF \(page \d+[^)]*\) ---\n/
  );
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i]!;
    const end = chunk.search(
      /\n\n--- (?:TABLES|FIGURES) FROM ORIGINAL PDF|\n\n\[from /
    );
    const md = (end >= 0 ? chunk.slice(0, end) : chunk).trim();
    if (!md.includes("|") || md.length < 12) continue;
    const fp = tableFingerprint(md);
    if (seen.has(fp)) continue;
    seen.add(fp);
    blocks.push(md);
  }
  return blocks;
}

function tableFingerprint(md: string): string {
  const row = md
    .split("\n")
    .find((l) => l.includes("|") && !/^\|[\s\-:|]+\|$/.test(l.trim()));
  return row ? row.replace(/\s+/g, " ").trim().slice(0, 80) : md.slice(0, 80);
}

function tableAlreadyInContent(content: string, md: string): boolean {
  const fp = tableFingerprint(md);
  if (fp.length >= 8 && content.includes(fp)) return true;

  const cells = fp
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
  if (cells.length >= 2) {
    const hits = cells.filter((c) => content.includes(c));
    if (hits.length >= Math.min(3, cells.length)) return true;
  }
  return false;
}

function figureAlreadyInContent(content: string, fig: IngestPageFigure): boolean {
  if (content.includes(fig.url)) return true;
  if (fig.caption.length > 8 && content.includes(fig.caption.slice(0, 40))) {
    return true;
  }
  return false;
}

function tokenizeForRelevance(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return new Set(words);
}

function relevanceScore(text: string, caption: string): number {
  const textTokens = tokenizeForRelevance(text);
  let score = 0;
  for (const t of tokenizeForRelevance(caption)) {
    if (textTokens.has(t)) score++;
  }
  return score;
}

function insertFigureInLessonContent(
  content: string,
  fig: IngestPageFigure
): string {
  const block = `![${fig.caption}](${fig.url})`;
  if (!content.trim()) return `### From your PDF\n\n${block}\n`;
  if (figureAlreadyInContent(content, fig)) return content;

  const lines = content.split("\n");
  let bestHeadingIdx = -1;
  let bestHeadingScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("## ")) continue;
    const score = relevanceScore(line, fig.caption);
    if (score > bestHeadingScore) {
      bestHeadingScore = score;
      bestHeadingIdx = i;
    }
  }

  const figureMd = `\n\n${block}\n`;
  if (bestHeadingIdx >= 0 && bestHeadingScore > 0) {
    let insertAt = bestHeadingIdx + 1;
    while (insertAt < lines.length && lines[insertAt]!.trim() === "") {
      insertAt++;
    }
    while (
      insertAt < lines.length &&
      !lines[insertAt]!.startsWith("#") &&
      lines[insertAt]!.trim() !== ""
    ) {
      insertAt++;
    }
    const before = lines.slice(0, insertAt).join("\n");
    const after = lines.slice(insertAt).join("\n");
    return `${before}${figureMd}${after}`.trim();
  }

  const paras = content.split(/\n\n+/);
  if (paras.length > 1) {
    return `${paras[0]}\n\n${block}\n\n${paras.slice(1).join("\n\n")}`.trim();
  }
  return `${content.trim()}${figureMd}`.trim();
}

/**
 * Place figures that page-locator injection missed by caption ↔ lesson topic match.
 */
function figureFromAsset(asset: CourseAsset): IngestPageFigure {
  return {
    key: asset.assetId,
    sourceFileName: asset.sourceFileName,
    pageNum: asset.sourcePage,
    url: asset.url,
    caption: asset.caption,
  };
}

async function scoreLessonForAsset(
  lessonText: string,
  asset: CourseAsset
): Promise<number> {
  if (asset.embedding.length > 0) {
    const lessonEmb = await embedText(lessonText.slice(0, 2500));
    return cosineSimilarity(lessonEmb, asset.embedding);
  }
  return relevanceScore(lessonText, asset.caption);
}

export async function injectUnplacedFiguresByRelevance(
  modules: CourseModule[],
  figures: IngestPageFigure[],
  manifest?: CourseAssetManifest | null
): Promise<CourseModule[]> {
  const figureAssets =
    manifest?.assets.filter((a) => a.type === "figure" && a.url) ?? [];
  const unplacedFigures = figures.filter(
    (f) =>
      !modules.some((m) =>
        m.lessons.some((l) => figureAlreadyInContent(l.content ?? "", f))
      )
  );
  const unplacedAssets = figureAssets.filter(
    (a) =>
      !modules.some((m) =>
        m.lessons.some((l) =>
          figureAlreadyInContent(l.content ?? "", figureFromAsset(a))
        )
      )
  );
  if (
    (unplacedFigures.length === 0 && unplacedAssets.length === 0) ||
    !modules.length
  ) {
    return modules;
  }

  const flat: {
    modIdx: number;
    lessonIdx: number;
    lesson: CourseModule["lessons"][number];
  }[] = [];
  modules.forEach((mod, modIdx) => {
    mod.lessons.forEach((lesson, lessonIdx) => {
      flat.push({ modIdx, lessonIdx, lesson });
    });
  });

  const next = modules.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => ({ ...l })),
  }));

  const placeFigure = (fig: IngestPageFigure, scoreFn: (text: string) => number) => {
    let best = { score: -1, modIdx: 0, lessonIdx: 0 };
    for (const { modIdx, lessonIdx, lesson } of flat) {
      const text = `${lesson.title}\n${(lesson.content ?? "").slice(0, 2500)}`;
      const score = scoreFn(text);
      if (score > best.score) best = { score, modIdx, lessonIdx };
    }
    const mod = next[best.modIdx]!;
    const lesson = mod.lessons[best.lessonIdx]!;
    mod.lessons[best.lessonIdx] = {
      ...lesson,
      content: insertFigureInLessonContent(lesson.content ?? "", fig),
    };
  };

  for (const fig of unplacedFigures) {
    placeFigure(fig, (text) => relevanceScore(text, fig.caption));
  }

  for (const asset of unplacedAssets) {
    const fig = figureFromAsset(asset);
    let best = { score: -1, modIdx: 0, lessonIdx: 0 };
    for (const { modIdx, lessonIdx, lesson } of flat) {
      const text = `${lesson.title}\n${(lesson.content ?? "").slice(0, 2500)}`;
      const score = await scoreLessonForAsset(text, asset);
      if (score > best.score) best = { score, modIdx, lessonIdx };
    }
    const mod = next[best.modIdx]!;
    const lesson = mod.lessons[best.lessonIdx]!;
    mod.lessons[best.lessonIdx] = {
      ...lesson,
      content: insertFigureInLessonContent(lesson.content ?? "", fig),
    };
  }

  return next;
}

function collectArtifactsForModule(
  planModuleIndex: number,
  plan: CourseStructurePlan,
  chunks: PersistedIngestChunk[],
  pageKeys: Set<string>,
  lookup: (key: string) => string | IngestPageFigure | undefined,
  kind: "table" | "figure"
): string[] | IngestPageFigure[] {
  const mod = plan.modules[planModuleIndex];
  if (!mod || pageKeys.size === 0) return [];

  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const chunkIds = new Set<string>();
  for (const lesson of mod.lessons) {
    for (const id of lesson.source_chunk_ids) chunkIds.add(id);
  }

  const seen = new Set<string>();
  const tables: string[] = [];
  const figures: IngestPageFigure[] = [];

  for (const id of chunkIds) {
    const chunk = chunkById.get(id);
    if (!chunk) continue;
    for (const pageNum of parsePageNumbersFromPosition(chunk.position)) {
      const key = pageTableKey(chunk.sourceFileName, pageNum);
      if (!pageKeys.has(key) || seen.has(key)) continue;
      const val = lookup(key);
      if (!val) continue;
      seen.add(key);
      if (kind === "table" && typeof val === "string") tables.push(val);
      if (kind === "figure" && typeof val === "object") figures.push(val);
    }
  }
  return kind === "table" ? tables : figures;
}

/** Vision-extracted tables for a module via plan chunk → page mapping. */
export function collectPdfTablesForModule(
  planModuleIndex: number,
  plan: CourseStructurePlan,
  chunks: PersistedIngestChunk[],
  pageTables: Map<string, string>
): string[] {
  return collectArtifactsForModule(
    planModuleIndex,
    plan,
    chunks,
    new Set(pageTables.keys()),
    (k) => pageTables.get(k),
    "table"
  ) as string[];
}

export function collectPdfFiguresForModule(
  planModuleIndex: number,
  plan: CourseStructurePlan,
  chunks: PersistedIngestChunk[],
  figures: IngestPageFigure[]
): IngestPageFigure[] {
  const mod = plan.modules[planModuleIndex];
  if (!mod || figures.length === 0) return [];

  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const chunkIds = new Set<string>();
  for (const lesson of mod.lessons) {
    for (const id of lesson.source_chunk_ids) chunkIds.add(id);
  }

  const seen = new Set<string>();
  const out: IngestPageFigure[] = [];
  for (const id of chunkIds) {
    const chunk = chunkById.get(id);
    if (!chunk) continue;
    for (const pageNum of parsePageNumbersFromPosition(chunk.position)) {
      for (const fig of figures) {
        if (!filesMatch(fig.sourceFileName, chunk.sourceFileName)) continue;
        if (fig.pageNum !== pageNum) continue;
        if (seen.has(fig.key)) continue;
        seen.add(fig.key);
        out.push(fig);
      }
    }
  }
  return out;
}

function dedupeTables(tables: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const fp = tableFingerprint(t);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(t);
  }
  return out;
}

/**
 * Tables display as cropped PNG screenshots (in `figures`), not markdown grids.
 * Markdown in `artifacts.tables` is chunk-indexing only.
 */
export function injectPdfTablesIntoModule(
  mod: CourseModule,
  _tables: string[]
): CourseModule {
  void _tables;
  return mod;
}

function figureBlockMarkdown(fig: IngestPageFigure): string {
  const isTable = fig.kind === "table";
  const heading = isTable
    ? `Table from your PDF (page ${fig.pageNum})`
    : `Figure from your PDF (page ${fig.pageNum})`;
  return `\n\n### ${heading}\n\n![${fig.caption}](${fig.url})\n`;
}

/** Inject cropped page visuals (figures + table screenshots) when embed omitted them. */
export function injectPdfFiguresIntoModule(
  mod: CourseModule,
  figures: IngestPageFigure[]
): CourseModule {
  const missing = figures.filter(
    (f) =>
      !mod.lessons.some((l) => figureAlreadyInContent(l.content ?? "", f))
  );
  if (missing.length === 0 || mod.lessons.length === 0) return mod;

  let figIdx = 0;
  const lessons = mod.lessons.map((lesson) => {
    let content = (lesson.content ?? "").trim();
    if (figIdx < missing.length) {
      const fig = missing[figIdx]!;
      if (!figureAlreadyInContent(content, fig)) {
        content += figureBlockMarkdown(fig);
      }
      figIdx++;
    }
    return { ...lesson, content };
  });

  if (figIdx < missing.length) {
    const lastIdx = lessons.length - 1;
    let content = lessons[lastIdx]!.content ?? "";
    while (figIdx < missing.length) {
      const fig = missing[figIdx]!;
      if (!figureAlreadyInContent(content, fig)) {
        content += figureBlockMarkdown(fig);
      }
      figIdx++;
    }
    lessons[lastIdx] = { ...lessons[lastIdx]!, content };
  }

  return { ...mod, lessons };
}

export function injectPdfArtifactsIntoModule(
  mod: CourseModule,
  tables: string[],
  figures: IngestPageFigure[]
): CourseModule {
  let next = injectPdfTablesIntoModule(mod, tables);
  next = injectPdfFiguresIntoModule(next, figures);
  return next;
}

export function injectPdfTablesIntoModules(
  modules: CourseModule[],
  plan: CourseStructurePlan | null,
  chunks: PersistedIngestChunk[],
  pageTables: Map<string, string>
): CourseModule[] {
  if (modules.length === 0) return modules;
  if (!plan && pageTables.size === 0) return modules;

  return modules.map((mod, i) => {
    const fromMap =
      plan && pageTables.size > 0
        ? collectPdfTablesForModule(i, plan, chunks, pageTables)
        : [];
    return injectPdfTablesIntoModule(mod, fromMap);
  });
}

/**
 * Guaranteed figure embed: match each lesson's `sources` locator (pages 5–6)
 * to uploaded page PNGs. Runs after attachLessonSources — uses the same page
 * refs the UI already displays.
 */
export function injectPageImagesFromLessonSources(
  modules: CourseModule[],
  sourceImages: IngestSourceImageRecord[]
): CourseModule[] {
  if (!sourceImages.length || !modules.length) return modules;

  return modules.map((mod) => ({
    ...mod,
    lessons: mod.lessons.map((lesson) => {
      if (!lesson.sources?.length) return lesson;

      const wanted: { fileName: string; pageNum: number }[] = [];
      for (const src of lesson.sources) {
        const pages = parsePagesFromSourceLocator(src.locator);
        for (const pageNum of pages) {
          wanted.push({ fileName: src.fileName, pageNum });
        }
      }
      if (wanted.length === 0) return lesson;

      const images: IngestSourceImageRecord[] = [];
      for (const { fileName, pageNum } of wanted) {
        for (const img of imagesForLessonPage(sourceImages, fileName, pageNum)) {
          if (!images.some((x) => x.url === img.url)) images.push(img);
        }
      }
      if (images.length === 0) return lesson;

      let content = (lesson.content ?? "").trim();
      const blocks: string[] = [];
      for (const img of images) {
        if (content.includes(img.url)) continue;
        const alt = img.label?.trim() || `Page ${img.anchorIndex}`;
        blocks.push(`![${alt}](${img.url})`);
      }
      if (blocks.length === 0) return lesson;

      const figureBlock = `### From your PDF\n\n${blocks.join("\n\n")}\n\n`;
      if (!content) {
        return { ...lesson, content: figureBlock.trim() };
      }
      if (lessonMarkdownHasImages(content)) {
        return { ...lesson, content: `${content}\n\n${figureBlock}`.trim() };
      }
      return { ...lesson, content: `${figureBlock}${content}`.trim() };
    }),
  }));
}

export function injectPdfArtifactsIntoModules(
  modules: CourseModule[],
  plan: CourseStructurePlan | null,
  chunks: PersistedIngestChunk[],
  artifacts: IngestPageArtifacts
): CourseModule[] {
  const tableMap = new Map(Object.entries(artifacts.tables));
  const figures = artifacts.figures;
  if (modules.length === 0) return modules;
  if (!plan && tableMap.size === 0 && figures.length === 0) return modules;

  return modules.map((mod, i) => {
    const tables =
      plan && tableMap.size > 0
        ? collectPdfTablesForModule(i, plan, chunks, tableMap)
        : [];
    const figs =
      plan && figures.length > 0
        ? collectPdfFiguresForModule(i, plan, chunks, figures)
        : [];
    return injectPdfArtifactsIntoModule(mod, tables, figs);
  });
}
