/**
 * Sanity check: pharmacology deck should yield ~6 modules, not 36.
 * Usage: npx tsx scripts/pharmacology-structure-sanity.ts [path-to.pdf]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDeterministicStructurePlan } from "@/lib/structure-plan-coverage";
import { buildIngestChunks, summarizeChunksForPlanner } from "@/lib/study-ingest/chunking";
import { extractStudyMaterialFromBuffer } from "@/lib/study-ingest/extract";

async function main() {
  const pdfPath =
    process.argv[2] ??
    "/Users/raphaelseo/Downloads/동남보건대_약리학_3장_중추신경계.pdf";
  const fileName = pdfPath.split("/").pop() ?? "upload.pdf";
  const buffer = readFileSync(resolve(pdfPath));

  const extracted = await extractStudyMaterialFromBuffer({
    buffer,
    fileName,
    kind: "pdf",
  });
  const chunks = buildIngestChunks([extracted]);
  const summaries = summarizeChunksForPlanner(chunks);
  const plan = buildDeterministicStructurePlan(summaries, "express");

  const lessonCount = plan.modules.reduce((n, m) => n + m.lessons.length, 0);
  const moduleCount = plan.modules.length;

  console.log(
    JSON.stringify(
      {
        chunks: chunks.length,
        lessons: lessonCount,
        modules: moduleCount,
        moduleTitles: plan.modules.map((m) => m.title),
        lessonTitles: plan.modules.flatMap((m) =>
          m.lessons.map((l) => l.title)
        ),
      },
      null,
      2
    )
  );

  if (moduleCount > 8 || lessonCount > 16) {
    console.error(
      `FAIL: expected ~6 modules / ~11 lessons, got ${moduleCount} modules / ${lessonCount} lessons`
    );
    process.exitCode = 1;
    return;
  }
  if (moduleCount < 4) {
    console.error(`FAIL: too few modules (${moduleCount})`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
