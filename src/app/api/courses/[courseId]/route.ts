import { NextResponse } from "next/server";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function PATCH(request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    title?: string;
    description?: string;
    isPublic?: unknown;
  };
  const title =
    typeof b.title === "string" ? b.title.trim() : undefined;
  const description =
    typeof b.description === "string" ? b.description.trim() : undefined;
  const isPublic =
    typeof b.isPublic === "boolean" ? b.isPublic : undefined;

  if (isPublic === true) {
    const { data: listing } = await supabase
      .from("course_listings")
      .select("status")
      .eq("course_id", courseId)
      .maybeSingle();
    const st = listing?.status as string | undefined;

    if (
      st === "draft" ||
      st === "pending_review" ||
      st === "approved"
    ) {
      if (!isMarketplaceUiEnabled()) {
        // Marketplace is hidden — suspend any in-progress listing so free Explore works.
        await supabase
          .from("course_listings")
          .update({
            status: "draft",
            approved_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("course_id", courseId)
          .in("status", ["draft", "pending_review", "approved"]);
      } else {
        return NextResponse.json(
          {
            error:
              "This course has a marketplace listing. Delist or remove the listing before enabling free Explore.",
          },
          { status: 409 }
        );
      }
    }
  }

  if (title !== undefined && title.length < 2) {
    return NextResponse.json(
      { error: "Title must be at least 2 characters." },
      { status: 400 }
    );
  }

  if (
    title === undefined &&
    description === undefined &&
    isPublic === undefined
  ) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 }
    );
  }

  const patch: Record<string, string | boolean> = {};
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (isPublic !== undefined) patch.is_public = isPublic;

  const { data: updated, error } = await supabase
    .from("courses")
    .update(patch)
    .eq("id", courseId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(error);
    const code = "code" in error ? String(error.code) : "";
    const msg = "message" in error ? String(error.message) : "";
    const missingIsPublic =
      isPublic !== undefined &&
      (code === "42703" ||
        /is_public|column .* does not exist/i.test(msg));
    if (missingIsPublic) {
      return NextResponse.json(
        {
          error:
            "Explore listing needs a one-time database update. In the Supabase SQL Editor, run `supabase/migrations/007_public_courses.sql` (adds the is_public column), then try again.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not update course." }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Course not found or you do not have access." },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: deleted, error } = await supabase
    .from("courses")
    .delete()
    .eq("id", courseId)
    .select("id, title")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not delete course." }, { status: 500 });
  }

  if (!deleted) {
    return NextResponse.json(
      { error: "Course not found or you do not have access." },
      { status: 403 }
    );
  }

  await logActivity({
    userId: user.id,
    type: "course_deleted",
    summary:
      typeof deleted.title === "string" && deleted.title.trim().length > 0
        ? deleted.title.trim()
        : "Untitled course",
    metadata: { courseId },
  });

  return NextResponse.json({ ok: true });
}
