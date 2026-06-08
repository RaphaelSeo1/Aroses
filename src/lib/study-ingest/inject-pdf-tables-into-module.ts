import type {
  CourseStructurePlan,
  CourseStructurePlanLesson,
  CourseStructurePlanModule,
} from "@/lib/ai/course-payload";
import type { PersistedIngestChunk } from "@/lib/source-attribution";
import {
  pagesForPlanLesson,
  parsePageNumbersFromPosition,
  tablePageOverlapsLesson,
} from "@/lib/study-ingest/chunk-position";
import {
  pageFigureCropKey,
  pageTableKey,
} from "@/lib/study-ingest/source-images/page-table-keys";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import {
  maxFiguresPerPage,
  shouldKeepFigureCaption,
} from "@/lib/pdf-ingest/filter-crop-quality";
import { isFullPageRenderImage } from "@/lib/study-ingest/source-images/is-page-render";
import type { CourseAssetManifest } from "@/lib/study-ingest/course-assets";
import {
  isUsableMarkdownTable,
  sanitizeLessonContent,
  sanitizeTableMarkdown,
  shouldSkipTableInjection,
} from "@/lib/study-ingest/table-text";
import type { CourseModule } from "@/types/course";

function filesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export { parsePagesFromSourceLocator } from "@/lib/source-attribution";

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
    let crops = imgs.filter(
      (i) =>
        !isFullPageFallbackLabel(i.label ?? "") &&
        shouldKeepFigureCaption(i.label ?? "")
    );
    if (crops.length === 0) {
      crops = imgs.filter(
        (i) =>
          /snapshot/i.test(i.label ?? "") &&
          shouldKeepFigureCaption(i.label ?? "")
      );
    }
    let fi = 0;
    for (const img of crops.slice(0, maxFiguresPerPage())) {
      const caption =
        img.label?.replace(/^Table:\s*/i, "").trim() ||
        `Diagram from page ${img.anchorIndex}`;
      out.push({
        key: pageFigureCropKey(img.sourceFileName, img.anchorIndex, fi),
        sourceFileName: img.sourceFileName,
        pageNum: img.anchorIndex,
        url: img.url,
        caption,
        kind: "figure",
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

export type PageTaggedTableBlock = {
  pageNum: number;
  markdown: string;
};

/** Pull page-tagged table markdown blocks embedded in module source text. */
export function extractPdfTableBlocksFromSource(
  sourceText: string
): PageTaggedTableBlock[] {
  const blocks: PageTaggedTableBlock[] = [];
  const seen = new Set<string>();

  const patterns: Array<{ re: RegExp; pageGroup: number }> = [
    {
      re: /--- TABLES FROM ORIGINAL PDF \(page (\d+)[^)]*\) ---\n/g,
      pageGroup: 1,
    },
    {
      re: /--- TABLE DATA FROM PDF \(page (\d+)[^)]*\) ---\n/g,
      pageGroup: 1,
    },
  ];

  for (const { re } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(sourceText)) !== null) {
      const pageNum = Number.parseInt(match[1]!, 10);
      if (!Number.isFinite(pageNum) || pageNum <= 0) continue;
      const start = match.index + match[0].length;
      const tail = sourceText.slice(start);
      const end = tail.search(
        /\n\n--- (?:TABLES|TABLE DATA|FIGURES) FROM|\n\n\[from /
      );
      const md = (end >= 0 ? tail.slice(0, end) : tail).trim();
      if (!md.includes("|") || md.length < 12) continue;
      const fp = tableFingerprint(md);
      if (seen.has(fp)) continue;
      seen.add(fp);
      blocks.push({ pageNum, markdown: md });
    }
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

export async function injectUnplacedFiguresByRelevance(
  modules: CourseModule[],
  _figures: IngestPageFigure[],
  _manifest?: CourseAssetManifest | null
): Promise<CourseModule[]> {
  void _figures;
  void _manifest;
  return modules;
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
    const cleaned = sanitizeTableMarkdown(t);
    if (!cleaned || !isUsableMarkdownTable(cleaned)) continue;
    const fp = tableFingerprint(cleaned);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(cleaned);
  }
  return out;
}

function appendTablesToContent(content: string, tables: string[]): string {
  let next = content.trim();
  for (const md of tables) {
    if (shouldSkipTableInjection(next, md)) continue;
    const cleaned = sanitizeTableMarkdown(md).trim();
    if (!cleaned.includes("|")) continue;
    if (tableAlreadyInContent(next, cleaned)) continue;
    next = next ? `${next}\n\n${cleaned}\n` : cleaned;
  }
  return sanitizeLessonContent(next);
}

function collectTablesForPlanLesson(
  planLesson: CourseStructurePlanLesson | undefined,
  chunksById: Map<string, PersistedIngestChunk>,
  pageTables: Map<string, string>,
  extraBlocks: PageTaggedTableBlock[] = []
): string[] {
  if (!planLesson) return [];
  const lessonPages = pagesForPlanLesson(planLesson, chunksById);
  if (lessonPages.size === 0) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of planLesson.source_chunk_ids) {
    const chunk = chunksById.get(id);
    if (!chunk) continue;
    for (const pageNum of parsePageNumbersFromPosition(chunk.position)) {
      if (!tablePageOverlapsLesson(pageNum, lessonPages)) continue;
      const key = pageTableKey(chunk.sourceFileName, pageNum);
      if (seen.has(key)) continue;
      const md = pageTables.get(key);
      if (!md?.trim()) continue;
      seen.add(key);
      out.push(md);
    }
  }

  for (const block of extraBlocks) {
    if (!tablePageOverlapsLesson(block.pageNum, lessonPages)) continue;
    const fp = tableFingerprint(block.markdown);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(block.markdown);
  }

  return dedupeTables(out);
}

/**
 * Inject vision-extracted tables into lessons that cover the same PDF pages
 * (via structure-plan chunk ids). Falls back to round-robin when no plan.
 */
export function injectPdfTablesIntoModule(
  mod: CourseModule,
  tables: string[] | PageTaggedTableBlock[],
  ctx?: {
    planModule?: CourseStructurePlanModule;
    chunks?: PersistedIngestChunk[];
    pageTables?: Map<string, string>;
  }
): CourseModule {
  if (mod.lessons.length === 0) return mod;

  const pageTables = ctx?.pageTables ?? new Map<string, string>();
  const planModule = ctx?.planModule;
  const chunks = ctx?.chunks;

  const taggedExtra: PageTaggedTableBlock[] = tables.map((t) =>
    typeof t === "string"
      ? { pageNum: 0, markdown: t }
      : t
  );
  const untagged = taggedExtra.filter((b) => b.pageNum <= 0);
  const tagged = taggedExtra.filter((b) => b.pageNum > 0);

  if (planModule && chunks) {
    const chunksById = new Map(chunks.map((c) => [c.id, c]));
    const lessons = mod.lessons.map((lesson, li) => {
      const planLesson = planModule.lessons[li];
      const forLesson = collectTablesForPlanLesson(
        planLesson,
        chunksById,
        pageTables,
        tagged
      );
      const content = appendTablesToContent(lesson.content ?? "", forLesson);
      return { ...lesson, content };
    });

    // Orphan tables are dropped — never dump unrelated grids into the last lesson.
    void untagged;
    return { ...mod, lessons };
  }

  const deduped = dedupeTables(
    tables.map((t) => (typeof t === "string" ? t : t.markdown))
  );
  if (deduped.length === 0) {
    return {
      ...mod,
      lessons: mod.lessons.map((lesson) => ({
        ...lesson,
        content: sanitizeLessonContent(lesson.content ?? ""),
      })),
    };
  }

  let tableIdx = 0;
  const lessons = mod.lessons.map((lesson) => {
    const batch =
      tableIdx < deduped.length ? [deduped[tableIdx]!] : ([] as string[]);
    if (tableIdx < deduped.length) tableIdx++;
    return {
      ...lesson,
      content: appendTablesToContent(lesson.content ?? "", batch),
    };
  });

  return { ...mod, lessons };
}

function collectPdfTablesFromPageMap(pageTables: Map<string, string>): string[] {
  return dedupeTables([...pageTables.values()]);
}

/** Figures attach via `visual_assets` — not inlined into lesson markdown. */
export function injectPdfFiguresIntoModule(
  mod: CourseModule,
  _figures: IngestPageFigure[]
): CourseModule {
  void _figures;
  return mod;
}

export function injectPdfArtifactsIntoModule(
  mod: CourseModule,
  tables: string[] | PageTaggedTableBlock[],
  figures: IngestPageFigure[],
  ctx?: {
    planModule?: CourseStructurePlanModule;
    chunks?: PersistedIngestChunk[];
    pageTables?: Map<string, string>;
  }
): CourseModule {
  let next = injectPdfTablesIntoModule(mod, tables, ctx);
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
    return injectPdfTablesIntoModule(mod, fromMap, {
      planModule: plan?.modules[i],
      chunks,
      pageTables,
    });
  });
}

/**
 * Guaranteed figure embed: match each lesson's `sources` locator (pages 5–6)
 * to uploaded page PNGs. Runs after attachLessonSources — uses the same page
 * refs the UI already displays.
 */
export function injectPageImagesFromLessonSources(
  modules: CourseModule[],
  _sourceImages: IngestSourceImageRecord[]
): CourseModule[] {
  void _sourceImages;
  return modules;
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
    return injectPdfArtifactsIntoModule(mod, tables, figs, {
      planModule: plan?.modules[i],
      chunks,
      pageTables: tableMap,
    });
  });
}
