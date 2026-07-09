import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

const MAX_SECTIONS = 50;

/**
 * PATCH /api/notes/sections/reorder
 * Body: { order: string[] } — custom section uuids in desired order.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { order?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.order) || body.order.length === 0) {
    return NextResponse.json({ error: "order required" }, { status: 400 });
  }

  const order = body.order
    .filter((id): id is string => typeof id === "string" && isUuid(id))
    .slice(0, MAX_SECTIONS);

  if (order.length === 0) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("user_note_sections")
    .select("id")
    .eq("user_id", user.id);

  const owned = new Set((existing ?? []).map((r) => r.id as string));
  if (order.length !== owned.size || order.some((id) => !owned.has(id))) {
    return NextResponse.json(
      { error: "Order must include every section exactly once." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  for (let i = 0; i < order.length; i += 1) {
    const { error } = await supabase
      .from("user_note_sections")
      .update({ sort_order: i, updated_at: now })
      .eq("id", order[i])
      .eq("user_id", user.id);
    if (error) {
      console.error("[notes sections reorder]", error);
      return NextResponse.json({ error: "Could not reorder." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
