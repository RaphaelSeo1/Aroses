import { NextResponse } from "next/server";
import {
  CALENDAR_SELECT,
  mapCalendarRow,
  parseCalendarPatch,
  toPatchRow,
} from "@/lib/calendar/items";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";

type Params = { params: Promise<{ itemId: string }> };

/**
 * PATCH /api/calendar/[itemId] — update fields or toggle complete.
 * DELETE /api/calendar/[itemId]
 */
export async function PATCH(request: Request, ctx: Params) {
  const { itemId } = await ctx.params;
  if (!isUuid(itemId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch = parseCalendarPatch(body);
  if (!patch || Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_calendar_items")
    .update(toPatchRow(patch))
    .eq("id", itemId)
    .eq("user_id", user.id)
    .select(CALENDAR_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[calendar PATCH]", error);
    return NextResponse.json(
      { error: "Could not update that." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    item: mapCalendarRow(data as Parameters<typeof mapCalendarRow>[0]),
  });
}

export async function DELETE(_request: Request, ctx: Params) {
  const { itemId } = await ctx.params;
  if (!isUuid(itemId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_calendar_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[calendar DELETE]", error);
    return NextResponse.json(
      { error: "Could not remove that." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
