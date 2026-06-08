/**
 * Pharmacology structure regression test.
 * Usage: npx tsx scripts/test-pharm-structure.ts [path-to.pdf]
 */
import { readFileSync } from "node:fs";
import { buildDeterministicStructurePlan } from "@/lib/structure-plan-coverage";
import { buildIngestChunks, summarizeChunksForPlanner } from "@/lib/study-ingest/chunking";
import { extractStudyMaterialFromBuffer } from "@/lib/study-ingest/extract";

async function main() {
  const pdfPath =
    process.argv[2] ??
    "/Users/raphaelseo/Downloads/동남보건대_약리학_3장_중추신경계.pdf";
  const fileName = pdfPath.split("/").pop() ?? "upload.pdf";
  const buffer = readFileSync(pdfPath);

  const extracted = await extractStudyMaterialFromBuffer({
    buffer,
    fileName,
    kind: "pdf",
  });
  const chunks = buildIngestChunks([extracted]);
  const summaries = summarizeChunksForPlanner(chunks);
  const plan = buildDeterministicStructurePlan(summaries, "express");
  const lessons = plan.modules.flatMap((m) => m.lessons);

  console.log("=== Pharmacology structure regression ===");
  console.log(`chunks: ${chunks.length}`);
  console.log(`lessons: ${lessons.length}`);
  console.log(`modules: ${plan.modules.length}`);
  console.log("\nmodule titles:");
  for (const m of plan.modules) {
    console.log(`  - ${m.title} (${m.lessons.length} lessons)`);
  }
  console.log("\nlesson titles:");
  for (const l of lessons) {
    console.log(`  - ${l.title} [${l.source_chunk_ids.length} chunks]`);
  }

  const ok =
    plan.modules.length >= 5 &&
    plan.modules.length <= 8 &&
    lessons.length >= 9 &&
    lessons.length <= 14;
  if (!ok) {
    console.error("\nFAIL: expected ~6 modules and ~11 lessons");
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
