import {
  cosineSimilarity,
  embedText,
} from "@/lib/embeddings/text-similarity";
import type { CourseModule } from "@/types/course";
import type { LessonVisualAsset, LessonVisualAssetType } from "@/types/course";
import {
  retrieveAssetsForQuery,
  type CourseAsset,
  type CourseAssetManifest,
} from "@/lib/study-ingest/course-assets";
import { splitLeadParagraph } from "@/lib/lesson-content-layout";

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
    asset.sourcePage > 0 ? ` from page ${asset.sourcePage} of your upload` : "";
  return `This ${asset.type === "table" ? "table" : "visual"}${page} supports "${lessonTitle.trim()}".`;
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

function contentHasAssetUrl(content: string, url: string): boolean {
  return content.includes(url);
}

function embedVisualInContent(
  content: string,
  visual: LessonVisualAsset
): string {
  if (contentHasAssetUrl(content, visual.imageUrl)) return content;
  const block = `\n\n![${visual.title}](${visual.imageUrl})\n\n`;
  const trimmed = content.trim();
  if (!trimmed) return block.trim();
  const { lead, body } = splitLeadParagraph(trimmed);
  if (lead && body) return `${lead}${block}${body}`.trim();
  return `${trimmed}${block}`.trim();
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

/**
 * Attach 1–3 retrieved PDF visual assets to each lesson (NotebookLM-style).
 * Also embeds image markdown in content for legacy renderers.
 */
export async function attachVisualAssetsToModules(input: {
  modules: CourseModule[];
  manifest: CourseAssetManifest | null;
  pagesRendered?: number;
  jobId?: string;
  minPerLesson?: number;
  maxPerLesson?: number;
}): Promise<AttachVisualAssetsResult> {
  const minPer = input.minPerLesson ?? 1;
  const maxPer = input.maxPerLesson ?? 3;
  const manifest = input.manifest;
  const assetsWithUrl = (manifest?.assets ?? []).filter((a) => a.url?.trim());

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

  let roundRobin = 0;

  for (const mod of next) {
    for (const lesson of mod.lessons) {
      lessonsProcessed++;
      const content = lesson.content ?? "";
      const query = `${mod.title}\n${lesson.title}\n${content.slice(0, 2000)}`;

      let retrieved = await retrieveAssetsForQuery(manifest!, query, maxPer);
      retrieved = retrieved.filter((a) => a.url?.trim());

      // Page hints from source attribution
      const sourcePages = new Set<number>();
      for (const src of lesson.sources ?? []) {
        for (const p of parsePagesFromLocator(src.locator)) sourcePages.add(p);
      }
      if (sourcePages.size > 0 && retrieved.length < minPer) {
        for (const page of sourcePages) {
          const onPage = assetsWithUrl.filter((a) => a.sourcePage === page);
          for (const a of onPage) {
            if (!retrieved.some((r) => r.assetId === a.assetId)) {
              retrieved.push(a);
            }
          }
        }
      }

      // MVP guarantee: at least one visual per lesson when assets exist
      if (retrieved.length < minPer) {
        const fallback = assetsWithUrl[roundRobin % assetsWithUrl.length]!;
        roundRobin++;
        if (!retrieved.some((r) => r.assetId === fallback.assetId)) {
          retrieved.push(fallback);
        }
      }

      retrieved = retrieved.slice(0, maxPer);

      const visuals: LessonVisualAsset[] = [];
      let contentOut = content;
      for (const asset of retrieved) {
        const v = visualAssetFromCourseAsset(asset, lesson.title, contentOut);
        if (!v) continue;
        if (visuals.some((x) => x.assetId === v.assetId)) continue;
        visuals.push(v);
        contentOut = embedVisualInContent(contentOut, v);
      }

      lesson.visual_assets = visuals.length > 0 ? visuals : undefined;
      lesson.content = contentOut;
      totalVisualsInserted += visuals.length;

      perLesson.push({
        moduleId: mod.id,
        lessonTitle: lesson.title,
        retrieved: retrieved.length,
        inserted: visuals.length,
      });

      console.info("[lesson-visual-assets] lesson attach", {
        jobId: input.jobId,
        moduleId: mod.id,
        lesson: lesson.title.slice(0, 60),
        retrieved: retrieved.length,
        inserted: visuals.length,
        assetIds: visuals.map((v) => v.assetId),
      });
    }
  }

  console.info("[lesson-visual-assets] attach complete", {
    jobId: input.jobId,
    pagesRendered: input.pagesRendered ?? 0,
    assetsAvailable: assetsWithUrl.length,
    captionsAvailable: manifest?.assets.filter((a) => a.caption?.trim()).length ?? 0,
    lessonsProcessed,
    totalVisualsInserted,
    avgPerLesson:
      lessonsProcessed > 0
        ? (totalVisualsInserted / lessonsProcessed).toFixed(2)
        : 0,
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
