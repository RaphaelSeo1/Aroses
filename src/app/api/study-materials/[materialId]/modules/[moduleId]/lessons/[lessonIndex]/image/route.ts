import { NextResponse } from "next/server";
import { classifyLessonImage } from "@/lib/ai/mentored";
import { searchWikimediaImage } from "@/lib/images/wikimedia";
import { lessonMarkdownHasImages } from "@/lib/lesson-content-layout";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type { CourseModule, CoursePayload } from "@/types/course";

/**
 * GET /api/study-materials/[materialId]/modules/[moduleId]/lessons/[lessonIndex]/image
 *
 * Returns the cached image for this lesson, OR — on cache miss —
 * classifies the lesson, searches Wikimedia, persists the result,
 * and returns it. Designed to be called on first render and ignored
 * after that (a `null` image response means "no image for this
 * lesson"; clients should not retry).
 *
 * Response shape:
 *   { image: null }                       // classifier said no
 *   { image: { url, thumbUrl, sourceUrl, attribution, type } }
 *
 * Per spec there's a soft cap of 10 cached images per course so we
 * don't blow up Wikimedia or our DB if every lesson decided it
 * needed one. After 10, we still return the cached classifier
 * decision but don't run NEW searches.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_IMAGES_PER_COURSE = 10;

type Params = {
  params: Promise<{
    materialId: string;
    moduleId: string;
    lessonIndex: string;
  }>;
};

type ImagePayload = {
  url: string;
  thumbUrl: string;
  sourceUrl: string;
  attribution: string;
  type: "diagram" | "photo" | "illustration";
};

export async function GET(_req: Request, ctx: Params) {
  const { materialId, moduleId: moduleIdRaw, lessonIndex: lessonIndexRaw } =
    await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }
  const moduleId = Number.parseInt(moduleIdRaw, 10);
  const lessonIndex = Number.parseInt(lessonIndexRaw, 10);
  if (!Number.isFinite(moduleId) || moduleId < 0) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
  }
  if (!Number.isFinite(lessonIndex) || lessonIndex < 0) {
    return NextResponse.json(
      { error: "Invalid lesson index." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // 1. Cache hit?
  const { data: cached } = await supabase
    .from("lesson_images")
    .select(
      "needs_image, image_url, image_thumb_url, source_page_url, attribution, image_type"
    )
    .eq("material_id", materialId)
    .eq("module_id", moduleId)
    .eq("lesson_idx", lessonIndex)
    .maybeSingle();

  if (cached) {
    if (!cached.needs_image || !cached.image_url) {
      return NextResponse.json({ image: null });
    }
    return NextResponse.json({
      image: {
        url: cached.image_url,
        thumbUrl: cached.image_thumb_url ?? cached.image_url,
        sourceUrl: cached.source_page_url ?? "",
        attribution: cached.attribution ?? "",
        type:
          cached.image_type === "diagram"
            ? "diagram"
            : cached.image_type === "photo"
              ? "photo"
              : "illustration",
      } satisfies ImagePayload,
    });
  }

  // 2. Need to classify — pull the lesson from the material payload.
  const { data: materialRow } = await supabase
    .from("study_materials")
    .select("course_payload, course_id")
    .eq("id", materialId)
    .maybeSingle();
  if (!materialRow?.course_payload || typeof materialRow.course_payload !== "object") {
    return NextResponse.json({ image: null });
  }
  const payload = materialRow.course_payload as CoursePayload;
  const lessonModule: CourseModule | undefined = payload.modules?.find(
    (m) => m.id === moduleId
  );
  const lesson = lessonModule?.lessons?.[lessonIndex];
  if (!lesson) {
    return NextResponse.json({ image: null });
  }

  if (lessonMarkdownHasImages(lesson.content)) {
    return NextResponse.json({ image: null });
  }

  // 3. Per-course cap on NEW image fetches. Cached "no image"
  //    classifier rows don't count — only cached rows with an actual
  //    image_url consume a slot. We still RUN the classifier (cheap
  //    Haiku call) so subsequent calls hit the cache, but skip the
  //    Wikimedia fetch when over the cap.
  const { count: imagesUsed } = await supabase
    .from("lesson_images")
    .select("id", { count: "exact", head: true })
    .eq("material_id", materialId)
    .eq("needs_image", true)
    .not("image_url", "is", null);
  const overCap = (imagesUsed ?? 0) >= MAX_IMAGES_PER_COURSE;

  // 4. Classify.
  const classification = await classifyLessonImage({
    lessonTitle: lesson.title,
    lessonContent: lesson.content,
    courseTitle: payload.title,
  });

  // 5. If classifier said no, or we're over the cap, persist a
  //    "no-image" verdict and return null. The cap path persists
  //    `needs_image: classification.needsImage` so if you raise the
  //    cap later we can backfill.
  if (!classification.needsImage || overCap) {
    await supabase.from("lesson_images").upsert(
      {
        material_id: materialId,
        module_id: moduleId,
        lesson_idx: lessonIndex,
        needs_image: classification.needsImage,
        search_query: classification.searchQuery || null,
        image_type: classification.imageType,
        image_url: null,
        image_thumb_url: null,
        source_page_url: null,
        attribution: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "material_id,module_id,lesson_idx" }
    );
    return NextResponse.json({ image: null });
  }

  // 6. Search Wikimedia. On failure, persist the miss so we don't
  //    keep retrying — students viewing this lesson later will just
  //    see no image (per spec, never a broken placeholder).
  const result = await searchWikimediaImage(
    classification.searchQuery,
    classification.imageType
  );

  await supabase.from("lesson_images").upsert(
    {
      material_id: materialId,
      module_id: moduleId,
      lesson_idx: lessonIndex,
      needs_image: true,
      search_query: classification.searchQuery,
      image_type: classification.imageType,
      image_url: result?.imageUrl ?? null,
      image_thumb_url: result?.thumbUrl ?? null,
      source_page_url: result?.sourcePageUrl ?? null,
      attribution: result?.attribution ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "material_id,module_id,lesson_idx" }
  );

  if (!result) {
    return NextResponse.json({ image: null });
  }

  return NextResponse.json({
    image: {
      url: result.imageUrl,
      thumbUrl: result.thumbUrl,
      sourceUrl: result.sourcePageUrl,
      attribution: result.attribution,
      type: classification.imageType,
    } satisfies ImagePayload,
  });
}
