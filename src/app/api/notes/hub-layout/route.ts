import { NextResponse } from "next/server";
import {
  applySectionOrder,
  isValidSectionOrder,
} from "@/lib/notes/hub-layout";
import { createClient } from "@/lib/supabase/server";

const MAX_SECTIONS = 60;

/**
 * GET /api/notes/hub-layout — saved sidebar section order.
 * PATCH — persist order. Body: { order: string[] }
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
    .from("user_notes_hub_layout")
    .select("section_order")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[notes hub-layout GET]", error);
    return NextResponse.json({ error: "Could not load layout." }, { status: 500 });
  }

  const order = Array.isArray(data?.section_order)
    ? (data.section_order as string[])
    : [];

  return NextResponse.json({ order });
}

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

  if (!Array.isArray(body.order)) {
    return NextResponse.json({ error: "order required" }, { status: 400 });
  }

  const order = body.order
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, MAX_SECTIONS);

  const [{ data: customSections }, layoutRes] = await Promise.all([
    supabase
      .from("user_note_sections")
      .select("id")
      .eq("user_id", user.id),
    supabase
      .from("user_notes_hub_layout")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const customIds = (customSections ?? []).map(
    (s) => `custom:${s.id as string}`
  );
  const allowed = new Set([
    "standalone",
    "live",
    "tutor",
    "course",
    ...customIds,
  ]);

  if (!isValidSectionOrder(order, allowed)) {
    return NextResponse.json({ error: "Invalid section order." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = layoutRes.data
    ? await supabase
        .from("user_notes_hub_layout")
        .update({ section_order: order, updated_at: now })
        .eq("user_id", user.id)
    : await supabase.from("user_notes_hub_layout").insert({
        user_id: user.id,
        section_order: order,
        updated_at: now,
      });

  if (error) {
    console.error("[notes hub-layout PATCH]", error);
    return NextResponse.json({ error: "Could not save layout." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, order });
}
