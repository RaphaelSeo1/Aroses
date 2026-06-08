import {
  cosineSimilarity,
  embedText,
} from "@/lib/embeddings/text-similarity";
import type { CourseModule } from "@/types/course";
import type { LessonVisualAsset, LessonVisualAssetType } from "@/types/course";
import type { CourseAsset, CourseAssetManifest } from "@/lib/study-ingest/course-assets";
import { shouldKeepFigureCaption } from "@/lib/pdf-ingest/filter-crop-quality";

export type AttachVisualAssetsResult = {
  modules: CourseModule[];
  pagesRendered: number;
  assetsAvailable: number;
  captionsAvailable: number;
  lessonsProcessed: number;
  totalVisualsInserted: number;
  perLesson: {
    moduleId: number;
    lessonTitle: string;
    retrieved: number;
    inserted: number;
  }[];
};

const MIN_SEMANTIC_SCORE = 0.24;
const SOURCE_PAGE_BOOST = 0.55;

function wordOverlapScore(text: string, caption: string): number {
  const words =
    caption.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  if (words.length === 0) return 0;
  const hay = text.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits / words.length;
}

function isEmbeddableFigureAsset(asset: CourseAsset): boolean {
  if (!asset.url?.trim()) return false;
  if (asset.type === "table") return false;
  if (!shouldKeepFigureCaption(asset.caption)) return false;
  const c = asset.caption.toLowerCase();
  if (c.includes("snapshot")) {
    const raw = process.env.PDF_INGEST_PAGE_SNAPSHOTS?.trim();
    if (raw !== "1" && raw?.toLowerCase() !== "true") return false;
  }
  return true;
}

function mapAssetType(asset: CourseAsset): LessonVisualAssetType {
  if (asset.type === "table") return "table";
  const c = asset.caption.toLowerCase();
  if (c.includes("snapshot") || c.includes("page ")) return "page_snapshot";
  if (c.includes("chart") || c.includes("graph")) return "chart";
  if (c.includes("diagram") || c.includes("flow") || c.includes("pathway")) {
    return "diagram";
  }
  return "image";
}

function paragraphCount(content: string): number {
  return content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

function whyRelevant(lessonTitle: string, asset: CourseAsset): string {
  const page =
    asset.sourcePage > 0 ? ` (page ${asset.sourcePage} of your upload)` : "";
  return `${asset.caption.trim()}${page} — supports "${lessonTitle.trim()}".`;
}

function visualAssetFromCourseAsset(
  asset: CourseAsset,
  lessonTitle: string,
  content: string
): LessonVisualAsset | null {
  if (!asset.url?.trim()) return null;
  const paras = paragraphCount(content);
  return {
    assetId: asset.assetId,
    imageUrl: asset.url,
    type: mapAssetType(asset),
    sourcePage: asset.sourcePage,
    title: asset.caption.slice(0, 80) || `Visual page ${asset.sourcePage}`,
    caption: asset.caption,
    whyRelevant: asset.teachingPurpose?.trim() || whyRelevant(lessonTitle, asset),
    placementAfterParagraph: paras > 1 ? 1 : 0,
  };
}

function parsePagesFromLocator(locator: string): number[] {
  const pages: number[] = [];
  const range = locator.match(/pages?\s*(\d+)\s*[–-]\s*(\d+)/i);
  if (range) {
    const a = Number.parseInt(range[1]!, 10);
    const b = Number.parseInt(range[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      for (let p = Math.min(a, b); p <= Math.max(a, b); p++) pages.push(p);
    }
    return pages;
  }
  const single = locator.match(/pages?\s*(\d+)/i);
  if (single) {
    const n = Number.parseInt(single[1]!, 10);
    if (Number.isFinite(n)) pages.push(n);
  }
  return pages;
}

function assetScore(
  queryEmb: number[],
  query: string,
  asset: CourseAsset
): number {
  if (asset.embedding.length > 0) {
    return cosineSimilarity(queryEmb, asset.embedding);
  }
  return wordOverlapScore(query, asset.caption);
}

type LessonSlot = {
  moduleId: number;
  lessonIndex: number;
  lessonTitle: string;
  query: string;
  queryEmb: number[];
  sourcePages: Set<number>;
};

function lessonKey(moduleId: number, lessonIndex: number): string {
  return `${moduleId}:${lessonIndex}`;
}

/**
 * Phase 1: assign figures from each lesson's cited source pages.
 * Phase 2: fill remaining slots via semantic match (no duplicate assets).
 */
async function assignFiguresAcrossCourse(input: {
  modules: CourseModule[];
  pool: CourseAsset[];
  maxPerLesson: number;
}): Promise<Map<string, CourseAsset[]>> {
  const { modules, pool, maxPerLesson } = input;
  const out = new Map<string, CourseAsset[]>();
  if (pool.length === 0) return out;

  const slots: LessonSlot[] = [];
  for (const mod of modules) {
    for (let li = 0; li < mod.lessons.length; li++) {
      const lesson = mod.lessons[li]!;
      const content = lesson.content ?? "";
      const query = `${mod.title}\n${lesson.title}\n${content.slice(0, 2000)}`;
      const sourcePages = new Set<number>();
      for (const src of lesson.sources ?? []) {
        for (const p of parsePagesFromLocator(src.locator)) sourcePages.add(p);
      }
      const queryEmb = await embedText(query.slice(0, 2500));
      slots.push({
        moduleId: mod.id,
        lessonIndex: li,
        lessonTitle: lesson.title,
        query,
        queryEmb,
        sourcePages,
      });
    }
  }

  const usedAssets = new Set<string>();
  const usedUrls = new Set<string>();

  const addToLesson = (
    moduleId: number,
    lessonIndex: number,
    asset: CourseAsset
  ): boolean => {
    if (usedAssets.has(asset.assetId)) return false;
    if (asset.url && usedUrls.has(asset.url)) return false;
    const key = lessonKey(moduleId, lessonIndex);
    const list = out.get(key) ?? [];
    if (list.length >= maxPerLesson) return false;
    list.push(asset);
    out.set(key, list);
    usedAssets.add(asset.assetId);
    if (asset.url) usedUrls.add(asset.url);
    return true;
  };

  // Phase 1 — source-page figures land on the lesson that cites that page.
  for (const slot of slots) {
    if (slot.sourcePages.size === 0) continue;
    const onPage = pool
      .filter(
        (a) =>
          slot.sourcePages.has(a.sourcePage) && !usedAssets.has(a.assetId)
      )
      .map((asset) => ({
        asset,
        score: assetScore(slot.queryEmb, slot.query, asset) + SOURCE_PAGE_BOOST,
      }))
      .sort((a, b) => b.score - a.score);

    for (const row of onPage) {
      if (addToLesson(slot.moduleId, slot.lessonIndex, row.asset)) break;
    }
  }

  // Phase 2 — semantic match for lessons still missing a diagram.
  type Edge = {
    moduleId: number;
    lessonIndex: number;
    asset: CourseAsset;
    score: number;
  };
  const edges: Edge[] = [];
  for (const slot of slots) {
    const key = lessonKey(slot.moduleId, slot.lessonIndex);
    if ((out.get(key)?.length ?? 0) >= maxPerLesson) continue;

    for (const asset of pool) {
      if (usedAssets.has(asset.assetId)) continue;
      const score = assetScore(slot.queryEmb, slot.query, asset);
      if (score >= MIN_SEMANTIC_SCORE) {
        edges.push({
          moduleId: slot.moduleId,
          lessonIndex: slot.lessonIndex,
          asset,
          score,
        });
      }
    }
  }

  edges.sort((a, b) => b.score - a.score);
  for (const edge of edges) {
    const key = lessonKey(edge.moduleId, edge.lessonIndex);
    if ((out.get(key)?.length ?? 0) >= maxPerLesson) continue;
    addToLesson(edge.moduleId, edge.lessonIndex, edge.asset);
  }

  return out;
}

/**
 * Attach clean PDF figures to the lessons that cite or semantically match them.
 */
export async function attachVisualAssetsToModules(input: {
  modules: CourseModule[];
  manifest: CourseAssetManifest | null;
  pagesRendered?: number;
  jobId?: string;
  minPerLesson?: number;
  maxPerLesson?: number;
}): Promise<AttachVisualAssetsResult> {
  const maxPer = input.maxPerLesson ?? 2;
  const manifest = input.manifest;
  const assetsWithUrl = (manifest?.assets ?? []).filter(isEmbeddableFigureAsset);

  const perLesson: AttachVisualAssetsResult["perLesson"] = [];
  let totalVisualsInserted = 0;
  let lessonsProcessed = 0;

  if (assetsWithUrl.length === 0 || input.modules.length === 0) {
    console.warn("[lesson-visual-assets] no assets with URLs — skipping attach", {
      jobId: input.jobId,
      manifestAssets: manifest?.assets.length ?? 0,
    });
    return {
      modules: input.modules,
      pagesRendered: input.pagesRendered ?? 0,
      assetsAvailable: 0,
      captionsAvailable: manifest?.assets.length ?? 0,
      lessonsProcessed: 0,
      totalVisualsInserted: 0,
      perLesson: [],
    };
  }

  const next = input.modules.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => ({ ...l })),
  }));

  const assignments = await assignFiguresAcrossCourse({
    modules: next,
    pool: assetsWithUrl,
    maxPerLesson: maxPer,
  });

  for (const mod of next) {
    for (let li = 0; li < mod.lessons.length; li++) {
      const lesson = mod.lessons[li]!;
      lessonsProcessed++;
      const key = lessonKey(mod.id, li);
      const retrieved = assignments.get(key) ?? [];

      const visuals: LessonVisualAsset[] = [];
      for (const asset of retrieved) {
        const v = visualAssetFromCourseAsset(asset, lesson.title, lesson.content ?? "");
        if (!v) continue;
        visuals.push(v);
      }

      lesson.visual_assets = visuals.length > 0 ? visuals : undefined;
      totalVisualsInserted += visuals.length;

      perLesson.push({
        moduleId: mod.id,
        lessonTitle: lesson.title,
        retrieved: retrieved.length,
        inserted: visuals.length,
      });
    }
  }

  console.info("[lesson-visual-assets] attach complete", {
    jobId: input.jobId,
    assetsAvailable: assetsWithUrl.length,
    lessonsProcessed,
    totalVisualsInserted,
    uniqueAssetsUsed: new Set(
      next.flatMap((m) =>
        m.lessons.flatMap((l) => (l.visual_assets ?? []).map((v) => v.assetId))
      )
    ).size,
  });

  return {
    modules: next,
    pagesRendered: input.pagesRendered ?? 0,
    assetsAvailable: assetsWithUrl.length,
    captionsAvailable:
      manifest?.assets.filter((a) => a.caption?.trim()).length ?? 0,
    lessonsProcessed,
    totalVisualsInserted,
    perLesson,
  };
}

/** Score lesson ↔ asset when embeddings missing (fallback). */
export async function scoreLessonAssetText(
  lessonText: string,
  asset: CourseAsset
): Promise<number> {
  if (asset.embedding.length > 0) {
    const emb = await embedText(lessonText.slice(0, 2500));
    return cosineSimilarity(emb, asset.embedding);
  }
  const words =
    asset.caption.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const text = lessonText.toLowerCase();
  return words.filter((w) => text.includes(w)).length;
}
