import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

type Params = { params: Promise<{ sectionId: string }> };

function normalizeEmoji(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, 16);
  return trimmed || null;
}

/**
 * PATCH /api/notes/sections/[sectionId] — rename and/or set emoji.
 * Body: { title?: string, emoji?: string | null }
 * DELETE — remove section (notes move back to My notes).
 */
export async function PATCH(request: Request, ctx: Params) {
  const { sectionId } = await ctx.params;
  if (!isUuid(sectionId)) {
    return NextResponse.json({ error: "Invalid section id" }, { status: 400 });
  }

  let body: { title?: unknown; emoji?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.title === "string") {
    if (!body.title.trim()) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }
    patch.title = body.title.trim().slice(0, 120);
  }

  if ("emoji" in body) {
    const emoji = normalizeEmoji(body.emoji);
    if (emoji === undefined) {
      return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
    }
    patch.emoji = emoji;
  }

  if (!("title" in patch) && !("emoji" in patch)) {
    return NextResponse.json(
      { error: "title or emoji required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let query = supabase
    .from("user_note_sections")
    .update(patch)
    .eq("id", sectionId)
    .eq("user_id", user.id)
    .select("id, title, emoji, sort_order, updated_at");

  let { data, error } = await query.maybeSingle();

  // Migration 086 may not be applied yet — retry without emoji.
  if (error && "emoji" in patch && /emoji/i.test(error.message ?? "")) {
    delete patch.emoji;
    if (!("title" in patch)) {
      return NextResponse.json(
        {
          error:
            "Could not save emoji. Apply migration 086_user_note_sections_emoji.sql in Supabase.",
        },
        { status: 503 }
      );
    }
    const retry = await supabase
      .from("user_note_sections")
      .update(patch)
      .eq("id", sectionId)
      .eq("user_id", user.id)
      .select("id, title, sort_order, updated_at")
      .maybeSingle();
    data = retry.data as typeof data;
    error = retry.error;
  }

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
