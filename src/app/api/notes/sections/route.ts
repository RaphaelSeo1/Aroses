import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/notes/sections — list the user's custom note sections.
 * POST — create a section. Body: { title?: string }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_note_sections")
    .select("id, title, sort_order, created_at, updated_at")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[notes sections GET]", error);
    return NextResponse.json({ error: "Could not load sections." }, { status: 500 });
  }

  return NextResponse.json({ sections: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const rawTitle = (body as { title?: unknown }).title;
  const title =
    typeof rawTitle === "string" && rawTitle.trim()
      ? rawTitle.trim().slice(0, 120)
      : "New section";

  const { data: maxRow } = await supabase
    .from("user_note_sections")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder =
    typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("user_note_sections")
    .insert({
      user_id: user.id,
      title,
      sort_order: sortOrder,
    })
    .select("id, title, sort_order, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("[notes sections POST]", error);
    return NextResponse.json(
      { error: "Could not create section." },
      { status: 500 }
    );
  }

  return NextResponse.json({ section: data });
}
