/**
 * Inspect stored lesson visuals for a study material.
 * Usage: npx tsx scripts/diagnose-lesson-visuals.ts [materialId]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCourseAssetManifest } from "@/lib/study-ingest/course-assets";
import { parseFiguresIndex } from "@/lib/mentored/source-figures";
import { resolveLessonVisualAssets } from "@/lib/lesson-visual-fallback";
import { pickLessonFigures } from "@/lib/lesson-pick-figures";
import type { CourseLesson, CourseModule } from "@/types/course";

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

function countVisuals(modules: CourseModule[]): {
  lessons: number;
  withStored: number;
  storedUrls: number;
} {
  let lessons = 0;
  let withStored = 0;
  let storedUrls = 0;
  for (const mod of modules) {
    for (const les of mod.lessons) {
      lessons++;
      const va = les.visual_assets?.filter((a) => a.imageUrl?.trim()) ?? [];
      if (va.length > 0) withStored++;
      storedUrls += va.length;
    }
  }
  return { lessons, withStored, storedUrls };
}

async function main() {
  loadEnvLocal();
  const admin = createAdminClient();
  if (!admin) {
    console.error("No admin client — check SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const materialIdArg = process.argv[2]?.trim();

  if (!materialIdArg) {
    const { data: rows, error } = await admin
      .from("study_materials")
      .select("id, file_name, created_at, asset_manifest, course_id")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("list error", error.message);
      process.exit(1);
    }
    console.log("\n=== Recent study materials ===");
    for (const r of rows ?? []) {
      const manifest = parseCourseAssetManifest(
        (r as { asset_manifest?: unknown }).asset_manifest
      );
      const figs =
        manifest?.assets.filter((a) => a.type !== "table" && a.url?.trim())
          .length ?? 0;
      console.log({
        id: r.id,
        file: (r as { file_name?: string }).file_name,
        courseId: (r as { course_id?: string }).course_id,
        manifestFigures: figs,
        created: (r as { created_at?: string }).created_at,
      });
    }
    console.log(
      "\nRe-run with: npx tsx scripts/diagnose-lesson-visuals.ts <materialId>"
    );
    return;
  }

  const { data, error } = await admin
    .from("study_materials")
    .select(
      "id, file_name, course_payload, asset_manifest, figures_index, course_id"
    )
    .eq("id", materialIdArg)
    .maybeSingle();

  if (error || !data) {
    console.error("material not found", error?.message);
    process.exit(1);
  }

  const payload = data.course_payload as { modules?: CourseModule[] } | null;
  const modules = (payload?.modules ?? []) as CourseModule[];
  const manifest = parseCourseAssetManifest(data.asset_manifest);
  const figuresIndex = parseFiguresIndex(data.figures_index);

  console.log("\n=== Material ===");
  console.log({
    id: data.id,
    file: data.file_name,
    courseId: data.course_id,
    moduleCount: modules.length,
  });

  console.log("\n=== asset_manifest ===");
  if (!manifest) {
    console.log("MISSING or empty");
  } else {
    const byType = { figure: 0, image: 0, table: 0 };
    let withUrl = 0;
    for (const a of manifest.assets) {
      byType[a.type]++;
      if (a.url?.trim()) withUrl++;
    }
    console.log({
      total: manifest.assets.length,
      withUrl,
      byType,
      sampleCaptions: manifest.assets.slice(0, 8).map((a) => ({
        type: a.type,
        page: a.sourcePage,
        url: a.url?.slice(0, 90),
        caption: a.caption.slice(0, 80),
      })),
    });
  }

  console.log("\n=== figures_index ===");
  if (!figuresIndex) {
    console.log("MISSING or empty");
  } else {
    console.log({
      figures: figuresIndex.figures.length,
      assignments: figuresIndex.assignments.length,
      sampleUrls: figuresIndex.figures.slice(0, 5).map((f) => ({
        label: f.label,
        url: f.url?.slice(0, 90),
        anchor: `${f.anchorType}:${f.anchorIndex}`,
      })),
    });
  }

  const stored = countVisuals(modules);
  console.log("\n=== lesson visual_assets in modules JSON ===");
  console.log(stored);

  const manifestList =
    manifest?.assets.map((a) => ({
      assetId: a.assetId,
      type: a.type,
      url: a.url,
      caption: a.caption,
      sourcePage: a.sourcePage,
    })) ?? [];

  console.log("\n=== resolved visuals per lesson (display simulation) ===");
  let resolvedTotal = 0;
  for (const mod of modules) {
    for (let li = 0; li < mod.lessons.length; li++) {
      const lesson = mod.lessons[li]!;
      const resolved = resolveLessonVisualAssets(lesson, manifestList);
      const n = resolved?.length ?? 0;
      if (n > 0) resolvedTotal += n;
      const storedN =
        lesson.visual_assets?.filter((a) => a.imageUrl?.trim()).length ?? 0;
      if (storedN > 0 || n > 0) {
        console.log({
          module: mod.id,
          lesson: li + 1,
          title: lesson.title.slice(0, 50),
          storedN,
          resolvedN: n,
          sources: lesson.sources?.map((s) => s.locator),
          urls: resolved?.map((a) => a.imageUrl.slice(0, 80)),
        });
      }
    }
  }
  console.log({ resolvedTotal });

  console.log("\n=== pickLessonFigures (UI simulation) ===");
  let pickTotal = 0;
  for (const mod of modules) {
    for (let li = 0; li < mod.lessons.length; li++) {
      const lesson = mod.lessons[li]!;
      const resolved = resolveLessonVisualAssets(lesson, manifestList);
      const picked = pickLessonFigures(lesson.content ?? "", resolved);
      pickTotal += picked.length;
      console.log({
        module: mod.id,
        lesson: li + 1,
        picked: picked.length,
        urls: picked.map((p) => p.url.split("/").pop()),
      });
    }
  }
  console.log({ pickTotal });

  // Full URLs + HTTP check
  const urls = new Set<string>();
  for (const mod of modules) {
    for (const les of mod.lessons) {
      const resolved = resolveLessonVisualAssets(les, manifestList);
      for (const v of resolved ?? []) urls.add(v.imageUrl);
    }
  }
  console.log("\n=== URL fetch check ===");
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      console.log({
        status: res.status,
        ok: res.ok,
        type: res.headers.get("content-type"),
        url: url.slice(0, 120),
      });
    } catch (e) {
      console.log({ error: String(e), url: url.slice(0, 120) });
    }
  }

  // course_assets table
  const { data: jobRow } = await admin
    .from("pdf_ingest_jobs")
    .select("id, status")
    .eq("material_id", materialIdArg)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobRow?.id) {
    const { data: assets, error: caErr } = await admin
      .from("course_assets")
      .select("asset_id, type, url, caption, source_page")
      .eq("job_id", jobRow.id)
      .limit(20);
    console.log("\n=== course_assets (latest job) ===");
    console.log({
      jobId: jobRow.id,
      status: jobRow.status,
      count: assets?.length ?? 0,
      error: caErr?.message,
      sample: assets?.slice(0, 6),
    });
  }
}

void main();
