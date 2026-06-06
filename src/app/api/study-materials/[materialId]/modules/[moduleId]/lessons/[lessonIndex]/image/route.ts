import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";

/**
 * GET /api/study-materials/[materialId]/modules/[moduleId]/lessons/[lessonIndex]/image
 *
 * Auto Wikimedia lesson images have been removed product-wide. This
 * endpoint no longer classifies lessons or searches the web — it only
 * returns an image the course CREATOR explicitly uploaded for this
 * lesson (via PATCH `replace`). Everything else returns `{ image: null }`,
 * including any previously auto-fetched Wikimedia rows still in the cache.
 *
 * Response shape:
 *   { image: null }
 *   { image: { url, thumbUrl, sourceUrl, attribution, type } }   // creator upload only
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  // Only serve a CREATOR-uploaded image (PATCH `replace` writes
  // search_query: "custom"). Auto Wikimedia rows are never returned.
  const { data: cached } = await supabase
    .from("lesson_images")
    .select("image_url, image_thumb_url, attribution, image_type, search_query")
    .eq("material_id", materialId)
    .eq("module_id", moduleId)
    .eq("lesson_idx", lessonIndex)
    .maybeSingle();

  if (cached && cached.image_url && cached.search_query === "custom") {
    return NextResponse.json({
      image: {
        url: cached.image_url,
        thumbUrl: cached.image_thumb_url ?? cached.image_url,
        sourceUrl: "",
        attribution: cached.attribution ?? "Added by the course creator",
        type:
          cached.image_type === "diagram"
            ? "diagram"
            : cached.image_type === "photo"
              ? "photo"
              : "illustration",
      } satisfies ImagePayload,
    });
  }

  return NextResponse.json({ image: null });
}

/**
 * Verifies the signed-in user OWNS the material (creator-only editing) and
 * returns an admin client for writing to `lesson_images` (RLS restricts
 * writes to the service role).
 */
async function requireOwnerAndAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  materialId: string,
  userId: string
): Promise<
  | { ok: true; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; status: number; error: string }
> {
  const { data: mat } = await supabase
    .from("study_materials")
    .select("user_id")
    .eq("id", materialId)
    .maybeSingle();
  if (!mat) return { ok: false, status: 404, error: "Not found." };
  if (mat.user_id !== userId) {
    return { ok: false, status: 403, error: "Only the course owner can edit images." };
  }
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, status: 503, error: "Image editing is not configured." };
  }
  return { ok: true, admin };
}

/**
 * PATCH — manually override this lesson's image (creator-only).
 *
 *   { action: "hide" }                 → remove the auto image
 *   { action: "replace", imageUrl }    → use a custom uploaded image
 *
 * Both write a row to `lesson_images` so the cached GET reflects the override
 * and the AI classifier never runs (or overwrites) this lesson again.
 */
export async function PATCH(req: Request, ctx: Params) {
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
    return NextResponse.json({ error: "Invalid lesson index." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const guard = await requireOwnerAndAdmin(supabase, materialId, user.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const admin = guard.admin!;

  let body: { action?: string; imageUrl?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const baseRow = {
    material_id: materialId,
    module_id: moduleId,
    lesson_idx: lessonIndex,
    updated_at: new Date().toISOString(),
  };

  if (body.action === "hide") {
    await admin.from("lesson_images").upsert(
      {
        ...baseRow,
        needs_image: false,
        search_query: null,
        image_type: null,
        image_url: null,
        image_thumb_url: null,
        source_page_url: null,
        attribution: null,
      },
      { onConflict: "material_id,module_id,lesson_idx" }
    );
    return NextResponse.json({ image: null });
  }

  if (body.action === "replace") {
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "A valid imageUrl is required." }, { status: 400 });
    }
    await admin.from("lesson_images").upsert(
      {
        ...baseRow,
        needs_image: true,
        search_query: "custom",
        image_type: "illustration",
        image_url: imageUrl,
        image_thumb_url: imageUrl,
        source_page_url: null,
        attribution: "Added by the course creator",
      },
      { onConflict: "material_id,module_id,lesson_idx" }
    );
    return NextResponse.json({
      image: {
        url: imageUrl,
        thumbUrl: imageUrl,
        sourceUrl: "",
        attribution: "Added by the course creator",
        type: "illustration",
      } satisfies ImagePayload,
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/**
 * DELETE — reset this lesson back to the automatic image pipeline
 * (creator-only). Removing the cached row lets the next GET re-classify and
 * re-fetch a Wikimedia image.
 */
export async function DELETE(_req: Request, ctx: Params) {
  const { materialId, moduleId: moduleIdRaw, lessonIndex: lessonIndexRaw } =
    await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }
  const moduleId = Number.parseInt(moduleIdRaw, 10);
  const lessonIndex = Number.parseInt(lessonIndexRaw, 10);
  if (!Number.isFinite(moduleId) || !Number.isFinite(lessonIndex)) {
    return NextResponse.json({ error: "Invalid lesson." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const guard = await requireOwnerAndAdmin(supabase, materialId, user.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const admin = guard.admin!;

  await admin
    .from("lesson_images")
    .delete()
    .eq("material_id", materialId)
    .eq("module_id", moduleId)
    .eq("lesson_idx", lessonIndex);

  return NextResponse.json({ ok: true });
}
