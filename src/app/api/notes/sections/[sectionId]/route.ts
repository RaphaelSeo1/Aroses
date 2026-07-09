import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

type Params = { params: Promise<{ sectionId: string }> };

/**
 * PATCH /api/notes/sections/[sectionId] — rename. Body: { title: string }
 * DELETE — remove section (notes move back to My notes).
 */
export async function PATCH(request: Request, ctx: Params) {
  const { sectionId } = await ctx.params;
  if (!isUuid(sectionId)) {
    return NextResponse.json({ error: "Invalid section id" }, { status: 400 });
  }

  let body: { title?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_note_sections")
    .update({
      title: body.title.trim().slice(0, 120),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sectionId)
    .eq("user_id", user.id)
    .select("id, title, sort_order, updated_at")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Update failed" }, { status: 404 });
  }
  return NextResponse.json({ section: data });
}

export async function DELETE(_req: Request, ctx: Params) {
  const { sectionId } = await ctx.params;
  if (!isUuid(sectionId)) {
    return NextResponse.json({ error: "Invalid section id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_note_sections")
    .delete()
    .eq("id", sectionId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[notes sections DELETE]", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
