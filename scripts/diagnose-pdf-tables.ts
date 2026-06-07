/**
 * Local PDF asset pipeline diagnostic (no Supabase upload).
 * Usage: npx tsx scripts/diagnose-pdf-tables.ts [path-to.pdf]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleModuleSourcesFromPlan,
  generateCourseModuleFromMaterial,
  structurePlanToOutline,
} from "@/lib/ai/study-generation";
import { buildDeterministicStructurePlan } from "@/lib/structure-plan-coverage";
import { buildIngestChunks, summarizeChunksForPlanner } from "@/lib/study-ingest/chunking";
import { extractStudyMaterialFromBuffer } from "@/lib/study-ingest/extract";
import { enrichChunksWithPageTables } from "@/lib/study-ingest/enrich-chunks-with-page-tables";
import {
  attachLessonSources,
  persistIngestChunks,
} from "@/lib/source-attribution";
import { renderPdfPagesToPng } from "@/lib/study-ingest/source-images/render-pdf-page";
import { enrichChunksWithPageFigures } from "@/lib/study-ingest/enrich-chunks-with-page-tables";
import {
  collectPdfTablesForModule,
  injectPdfArtifactsIntoModule,
  pageFiguresFromSourceImages,
} from "@/lib/study-ingest/inject-pdf-tables-into-module";
import type { CourseModule } from "@/types/course";
import { lessonMarkdownHasImages } from "@/lib/lesson-content-layout";
import { targetPdfPagesForVision } from "@/lib/study-ingest/source-images/supplement-pdf-pages";
import {
  countMarkdownTables,
  diagnoseMaterialTables,
  enhanceTabularPlaintext,
} from "@/lib/study-ingest/table-text";
import { getPdfPageCount } from "@/lib/study-ingest/source-images/render-pdf-page";
import { runPdfAssetPipeline } from "@/lib/pdf-ingest/asset-pipeline";
import { placeCourseAssetsIntoModules } from "@/lib/pdf-ingest/place-course-assets";
import type { CourseAssetRow } from "@/lib/pdf-ingest/persist-course-assets";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  loadEnvLocal();
  const pdfPath =
    process.argv[2] ??
    "/Users/raphaelseo/Downloads/동남보건대_약리학_3장_중추신경계.pdf";
  const fileName = pdfPath.split("/").pop() ?? "upload.pdf";
  const buffer = readFileSync(pdfPath);

  console.log("\n=== 1. PDF text extraction ===");
  const extracted = await extractStudyMaterialFromBuffer({
    buffer,
    fileName,
    kind: "pdf",
  });
  const rawDiag = diagnoseMaterialTables(extracted.plainText);
  console.log("plainText diagnostics:", rawDiag);
  const enhanced = enhanceTabularPlaintext(extracted.plainText);
  const enhDiag = diagnoseMaterialTables(enhanced);
  console.log("after enhanceTabularPlaintext:", enhDiag);

  console.log("\n=== 2. Chunking ===");
  const chunks = buildIngestChunks([extracted]);
  console.log(`chunks: ${chunks.length}`);

  console.log("\n=== 3. Structure plan (deterministic) ===");
  const summaries = summarizeChunksForPlanner(chunks);
  const plan = buildDeterministicStructurePlan(summaries, "express");
  const outline = structurePlanToOutline(plan);
  console.log(`modules: ${outline.modules.length}`, outline.modules.map((m) => m.title));

  console.log("\n=== 4. Page render ===");
  const pageCount = await getPdfPageCount(buffer);
  const persisted = persistIngestChunks(chunks);
  const targetPages = targetPdfPagesForVision({
    fileName,
    pageCount,
    chunks: persisted,
  });
  console.log(`pageCount=${pageCount} visionPages (${targetPages.length})`);

  const toRender = targetPages.slice(0, 120);
  const rendered = await renderPdfPagesToPng(Buffer.from(buffer), toRender, fileName);
  console.log(`rendered ${rendered.length} page PNGs`);

  console.log("\n=== 5. EXTRACT + CLASSIFY (unified pipeline, local) ===");
  const pipeline = await runPdfAssetPipeline({
    jobId: "diagnose-local",
    pdfBuffer: Buffer.from(buffer),
    fileName,
    renderedPages: rendered,
    persistToDb: false,
    localOnly: true,
  });

  console.log("\n=== 6. Chunk enrichment ===");
  const pageTables = new Map(Object.entries(pipeline.pageArtifacts.tables));
  const pageFigures = pageFiguresFromSourceImages(pipeline.sourceImages);
  let enriched = enrichChunksWithPageTables(chunks, pageTables);
  enriched = enrichChunksWithPageFigures(enriched, pageFigures);
  console.log(`chunks with table blocks: ${enriched.filter((c) => c.text.includes("TABLES FROM ORIGINAL PDF")).length}`);

  console.log("\n=== 7. Module sources ===");
  const moduleSources = assembleModuleSourcesFromPlan(plan, enriched);
  const totalMd = moduleSources.reduce((n, s) => n + countMarkdownTables(s), 0);
  console.log(`total mdTables in module sources: ${totalMd}`);

  console.log("\n=== 8. PLACE INTO COURSE (caption similarity) ===");
  const stubModules: CourseModule[] = outline.modules.map((m, mi) => ({
    id: m.id,
    title: m.title,
    lessons: m.lesson_titles.map((title) => ({
      title,
      content: `## ${title}\n\nStub lesson for module ${mi + 1} covering topics from the CNS pharmacology deck.`,
      key_terms: [],
      examples: [],
    })),
    quiz: [],
  }));

  const assetRows: CourseAssetRow[] = pipeline.courseAssetRows.map((r, i) => ({
    id: `local-${i}`,
    type: r.type,
    source: r.source,
    source_page: r.source_page,
    asset_url: r.asset_url ?? pipeline.sourceImages[i]?.url ?? null,
    markdown: r.markdown ?? null,
    caption: r.caption,
    caption_embedding: r.caption_embedding ?? null,
  }));

  const placed = await placeCourseAssetsIntoModules(stubModules, assetRows, {
    jobId: "diagnose-local",
  });

  let lessonsWithAssets = 0;
  let lessonsWithTables = 0;
  let lessonsWithImages = 0;
  for (const mod of placed.modules) {
    for (const lesson of mod.lessons) {
      const content = lesson.content ?? "";
      const hasTable = content.includes("|") && content.includes("---");
      const hasImg = lessonMarkdownHasImages(content);
      if (hasTable || hasImg) lessonsWithAssets++;
      if (hasTable) lessonsWithTables++;
      if (hasImg) lessonsWithImages++;
    }
  }

  console.log("\n=== STAGE COUNTS SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        EXTRACT: pipeline.extractCounts,
        CLASSIFY: pipeline.classifyCounts,
        PLACE: placed.placeCounts,
        postPlace: {
          lessonsWithAssets,
          lessonsWithTables,
          lessonsWithImages,
        },
      },
      null,
      2
    )
  );

  if (process.env.RUN_MODULE_GEN === "1" && process.env.ANTHROPIC_API_KEY) {
    console.log("\n=== 9. Live module 2 generation ===");
    const mod2Idx = 1;
    const mod = await generateCourseModuleFromMaterial(
      moduleSources[mod2Idx] ?? "",
      outline,
      mod2Idx
    );
    const mod2Tables = collectPdfTablesForModule(
      mod2Idx,
      plan,
      persisted,
      pageTables
    );
    const injected = injectPdfArtifactsIntoModule(mod, mod2Tables, pageFigures);
    const placedLive = await placeCourseAssetsIntoModules(injected, assetRows, {
      jobId: "diagnose-local",
    });
    const lessonText = placedLive.modules.flatMap((m) => m.lessons).map((l) => l.content).join("\n\n");
    console.log(
      `live module mdTables=${countMarkdownTables(lessonText)} hasImages=${lessonMarkdownHasImages(lessonText)}`
    );
  }

  if (pipeline.extractCounts.pagesRendered === 0) {
    process.exitCode = 1;
  }
  if (placed.placeCounts.assetsAvailable > 0 && placed.placeCounts.assetsInjected === 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
