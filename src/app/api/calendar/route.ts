import { NextResponse } from "next/server";
import {
  CALENDAR_SELECT,
  mapCalendarRow,
  parseCalendarInput,
  toInsertRow,
} from "@/lib/calendar/items";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";

/**
 * GET /api/calendar — list the signed-in user's calendar items.
 * POST /api/calendar — create a todo or event.
 */
export async function GET() {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_calendar_items")
    .select(CALENDAR_SELECT)
    .eq("user_id", user.id)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(400);

  if (error) {
    if (
      error.code === "42P01" ||
      /user_calendar_items/i.test(error.message ?? "")
    ) {
      return NextResponse.json({ items: [] });
    }
    console.error("[calendar GET]", error);
    return NextResponse.json(
      { error: "Could not load calendar." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    items: (data ?? []).map((row) =>
      mapCalendarRow(row as Parameters<typeof mapCalendarRow>[0])
    ),
  });
}

export async function POST(request: Request) {
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

  const input = parseCalendarInput(body);
  if (!input) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_calendar_items")
    .insert(toInsertRow(user.id, input))
    .select(CALENDAR_SELECT)
    .single();

  if (error || !data) {
    console.error("[calendar POST]", error);
    return NextResponse.json(
      { error: "Could not add that." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    item: mapCalendarRow(data as Parameters<typeof mapCalendarRow>[0]),
  });
}
