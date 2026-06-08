/**
 * Usage: npx tsx scripts/check-lesson-pick.ts [materialId] [moduleId] [lessonIndex]
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { extractMarkdownFigures } from "@/lib/lesson-content-layout";
import { pickLessonFigures } from "@/lib/lesson-pick-figures";
import { resolveLessonVisualAssets } from "@/lib/lesson-visual-fallback";
import type { CourseLesson, CourseModule } from "@/types/course";

async function main() {
  const materialId = process.argv[2] ?? "46fd5862-d4fc-4015-a2f5-4513eec94326";
  const modId = Number(process.argv[3] ?? 1);
  const lessonIdx = Number(process.argv[4] ?? 1);

  const admin = createAdminClient();
  const { data } = await admin
    .from("study_materials")
    .select("course_payload,asset_manifest")
    .eq("id", materialId)
    .single();

  const modules = (data?.course_payload as { modules?: CourseModule[] })?.modules ?? [];
  const mod = modules.find((m) => m.id === modId);
  const lesson = mod?.lessons[lessonIdx] as CourseLesson | undefined;
  const manifestList =
    (data?.asset_manifest as { assets?: Parameters<typeof resolveLessonVisualAssets>[1] } | null)
      ?.assets ?? [];

  if (!lesson) {
    console.error("lesson not found");
    process.exit(1);
  }

  const resolved = resolveLessonVisualAssets(lesson, manifestList);

  console.log("lesson:", lesson.title);
  console.log("\nstored visual_assets:");
  for (const v of lesson.visual_assets ?? []) {
    console.log(" -", v.caption, v.imageUrl?.slice(-55));
  }
  console.log("\nresolved:");
  for (const v of resolved ?? []) {
    console.log(" -", v.caption, v.imageUrl?.slice(-55));
  }
  const picked = pickLessonFigures(lesson.content ?? "", resolved);
  console.log("\npicked:");
  for (const p of picked) {
    console.log(" -", p.alt, p.url.slice(-55));
  }
  console.log("\nmarkdown images:", extractMarkdownFigures(lesson.content ?? ""));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
