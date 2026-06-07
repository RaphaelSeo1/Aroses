import {
  cosineSimilarity,
  embedText,
} from "@/lib/embeddings/text-similarity";
import type { CourseModule } from "@/types/course";
import {
  logPlaceCounts,
  type PdfAssetPlaceCounts,
} from "@/lib/pdf-ingest/stage-counts";
import type { CourseAssetRow } from "@/lib/pdf-ingest/persist-course-assets";
import type {
  CourseAsset,
  CourseAssetManifest,
} from "@/lib/study-ingest/course-assets";
import type { IngestPageArtifacts } from "@/lib/study-ingest/inject-pdf-tables-into-module";

function tableFingerprint(md: string): string {
  const row = md
    .split("\n")
    .find((l) => l.includes("|") && !/^\|[\s\-:|]+\|$/.test(l.trim()));
  return row ? row.replace(/\s+/g, " ").trim().slice(0, 80) : md.slice(0, 80);
}

/** Strict: only skip when the exact asset URL or table markdown is already present. */
function assetAlreadyInLesson(content: string, asset: CourseAssetRow): boolean {
  if (asset.asset_url && content.includes(asset.asset_url)) return true;
  if (asset.type === "table" && asset.markdown?.trim()) {
    const fp = tableFingerprint(asset.markdown);
    if (fp.length >= 12 && content.includes(fp)) return true;
  }
  return false;
}

function markdownBlockForAsset(asset: CourseAssetRow): string {
  if (asset.asset_url) {
    const alt =
      asset.caption.trim() ||
      (asset.type === "table"
        ? `Table from page ${asset.source_page}`
        : `Figure from page ${asset.source_page}`);
    return `\n\n![${alt}](${asset.asset_url})\n\n`;
  }
  if (asset.type === "table" && asset.markdown?.trim()) {
    return `\n\n${asset.markdown.trim()}\n\n`;
  }
  return "";
}

function insertBlockInLessonContent(
  content: string,
  block: string,
  caption: string
): string {
  if (!block.trim()) return content;
  if (!content.trim()) return block.trim();

  const lines = content.split("\n");
  let bestHeadingIdx = -1;
  let bestHeadingScore = 0;
  const captionWords = caption.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("## ")) continue;
    const lineLower = line.toLowerCase();
    let score = 0;
    for (const w of captionWords) {
      if (lineLower.includes(w)) score++;
    }
    if (score > bestHeadingScore) {
      bestHeadingScore = score;
      bestHeadingIdx = i;
    }
  }

  if (bestHeadingIdx >= 0 && bestHeadingScore > 0) {
    let insertAt = bestHeadingIdx + 1;
    while (insertAt < lines.length && lines[insertAt]!.trim() === "") insertAt++;
    while (
      insertAt < lines.length &&
      !lines[insertAt]!.startsWith("#") &&
      lines[insertAt]!.trim() !== ""
    ) {
      insertAt++;
    }
    const before = lines.slice(0, insertAt).join("\n");
    const after = lines.slice(insertAt).join("\n");
    return `${before}${block}${after}`.trim();
  }

  const paras = content.split(/\n\n+/);
  if (paras.length > 1) {
    return `${paras[0]}\n\n${block.trim()}\n\n${paras.slice(1).join("\n\n")}`.trim();
  }
  return `${content.trim()}${block}`.trim();
}

async function scoreLessonForAsset(
  lessonTitle: string,
  lessonContent: string,
  asset: CourseAssetRow
): Promise<number> {
  const lessonText = `${lessonTitle}\n${lessonContent.slice(0, 2500)}`;
  const embedding = asset.caption_embedding;
  if (Array.isArray(embedding) && embedding.length > 0) {
    const lessonEmb = await embedText(lessonText);
    return cosineSimilarity(lessonEmb, embedding);
  }
  const captionWords =
    asset.caption.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const textLower = lessonText.toLowerCase();
  let score = 0;
  for (const w of captionWords) {
    if (textLower.includes(w)) score++;
  }
  return score;
}

export type PlaceCourseAssetsResult = {
  modules: CourseModule[];
  placeCounts: PdfAssetPlaceCounts;
  receivingLessons: string[];
};

export function courseAssetToRow(asset: CourseAsset, id: string): CourseAssetRow {
  return {
    id,
    type: asset.type,
    source: asset.type === "table" ? "table_markdown" : "structural_raster",
    source_page: asset.sourcePage,
    asset_url: asset.url?.trim() ? asset.url.trim() : null,
    markdown: asset.markdown ?? null,
    caption: asset.caption,
    caption_embedding:
      asset.embedding.length > 0 ? asset.embedding : null,
  };
}

export function manifestToAssetRows(
  manifest: CourseAssetManifest | null | undefined
): CourseAssetRow[] {
  if (!manifest?.assets.length) return [];
  return manifest.assets.map((a) => courseAssetToRow(a, a.assetId));
}

export function pageArtifactsToAssetRows(
  artifacts: IngestPageArtifacts
): CourseAssetRow[] {
  const rows: CourseAssetRow[] = [];
  for (const [key, markdown] of Object.entries(artifacts.tables)) {
    if (!markdown?.trim()) continue;
    const m = key.match(/^(.+):p(\d+)$/i);
    const pageNum = Number.parseInt(m?.[2] ?? "0", 10);
    if (!Number.isFinite(pageNum) || pageNum <= 0) continue;
    rows.push({
      id: key,
      type: "table",
      source: "table_markdown",
      source_page: pageNum,
      asset_url: null,
      markdown,
      caption: markdown.split("\n")[0]?.slice(0, 160) ?? `Table page ${pageNum}`,
      caption_embedding: null,
    });
  }
  for (const fig of artifacts.figures) {
    if (!fig.url) continue;
    rows.push({
      id: fig.key,
      type: "figure",
      source: "structural_raster",
      source_page: fig.pageNum,
      asset_url: fig.url,
      markdown: null,
      caption: fig.caption,
      caption_embedding: null,
    });
  }
  return rows;
}

function dedupeAssetRows(rows: CourseAssetRow[]): CourseAssetRow[] {
  const seen = new Set<string>();
  const out: CourseAssetRow[] = [];
  for (const r of rows) {
    const key =
      r.type === "table" && r.markdown
        ? `table:${tableFingerprint(r.markdown)}`
        : `fig:${r.asset_url ?? r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Insert kept PDF assets (GFM tables + markdown images) into lesson bodies
 * by caption ↔ lesson-topic similarity.
 */
export async function placeCourseAssetsIntoModules(
  modules: CourseModule[],
  assets: CourseAssetRow[],
  options?: { jobId?: string; minScore?: number }
): Promise<PlaceCourseAssetsResult> {
  const jobId = options?.jobId;

  const placeCounts: PdfAssetPlaceCounts = {
    assetsAvailable: assets.length,
    assetsInjected: 0,
    lessonsReceiving: 0,
  };

  if (assets.length === 0 || modules.length === 0) {
    logPlaceCounts(jobId, placeCounts, []);
    return { modules, placeCounts, receivingLessons: [] };
  }

  const next = modules.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => ({ ...l })),
  }));

  const receiving = new Set<string>();

  for (const asset of assets) {
    const block = markdownBlockForAsset(asset);
    if (!block.trim()) {
      console.warn(
        `[pdf-asset-pipeline] PLACE skip page=${asset.source_page} type=${asset.type}: no markdown/url`
      );
      continue;
    }

    let best = { score: -1, modIdx: 0, lessonIdx: 0 };
    for (let modIdx = 0; modIdx < next.length; modIdx++) {
      const mod = next[modIdx]!;
      for (let lessonIdx = 0; lessonIdx < mod.lessons.length; lessonIdx++) {
        const lesson = mod.lessons[lessonIdx]!;
        const content = lesson.content ?? "";
        if (assetAlreadyInLesson(content, asset)) continue;
        const score = await scoreLessonForAsset(
          lesson.title,
          content,
          asset
        );
        if (score > best.score) best = { score, modIdx, lessonIdx };
      }
    }

    const mod = next[best.modIdx]!;
    const lesson = mod.lessons[best.lessonIdx]!;
    if (assetAlreadyInLesson(lesson.content ?? "", asset)) {
      continue;
    }

    mod.lessons[best.lessonIdx] = {
      ...lesson,
      content: insertBlockInLessonContent(
        lesson.content ?? "",
        block,
        asset.caption
      ),
    };

    placeCounts.assetsInjected++;
    const label = `${mod.title} / ${lesson.title}`;
    receiving.add(label);
    console.info(
      `[pdf-asset-pipeline] PLACE injected page=${asset.source_page} type=${asset.type} → "${label}" score=${best.score.toFixed(3)}`
    );
  }

  placeCounts.lessonsReceiving = receiving.size;
  const receivingLessons = [...receiving];
  logPlaceCounts(jobId, placeCounts, receivingLessons);

  return { modules: next, placeCounts, receivingLessons };
}

/** Merge manifest + page artifacts + optional DB rows; place all into lessons. */
export async function placeAllPdfAssetsIntoModules(
  modules: CourseModule[],
  input: {
    manifest?: CourseAssetManifest | null;
    pageArtifacts?: IngestPageArtifacts;
    courseAssets?: CourseAssetRow[];
    jobId?: string;
  }
): Promise<PlaceCourseAssetsResult> {
  const rows = dedupeAssetRows([
    ...manifestToAssetRows(input.manifest),
    ...pageArtifactsToAssetRows(
      input.pageArtifacts ?? { tables: {}, figures: [] }
    ),
    ...(input.courseAssets ?? []),
  ]);
  return placeCourseAssetsIntoModules(modules, rows, { jobId: input.jobId });
}
