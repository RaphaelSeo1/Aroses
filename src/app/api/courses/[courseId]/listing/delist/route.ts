import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function POST(_req: Request, ctx: Params) {
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

  const { data: updated, error } = await supabase
    .from("course_listings")
    .update({
      status: "draft",
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("course_id", courseId)
    .eq("seller_user_id", user.id)
    .eq("status", "approved")
    .select("course_id")
    .maybeSingle();

  if (error) {
    console.error("[listing delist]", error);
    return NextResponse.json({ error: "Could not delist." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "No live listing found for this course." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
