import { NextResponse } from "next/server";
import {
  CALENDAR_SECTIONS_MAX,
  CALENDAR_SECTIONS_SELECT,
  mapSectionRow,
  parseSectionTitle,
} from "@/lib/calendar/sections";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";

/**
 * POST /api/calendar/sections — create a to-do list section.
 */
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
    body = {};
  }

  const title = parseSectionTitle(
    (body as { title?: unknown })?.title
  ) ?? "New section";

  const { count, error: countErr } = await supabase
    .from("user_calendar_todo_sections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countErr) {
    if (
      countErr.code === "42P01" ||
      /user_calendar_todo_sections/i.test(countErr.message ?? "")
    ) {
      return NextResponse.json(
        { error: "Apply migration 107_calendar_todo_sections.sql in Supabase." },
        { status: 503 }
      );
    }
    console.error("[calendar sections POST count]", countErr);
    return NextResponse.json(
      { error: "Could not create section." },
      { status: 500 }
    );
  }
  if ((count ?? 0) >= CALENDAR_SECTIONS_MAX) {
    return NextResponse.json(
      { error: "Too many sections." },
      { status: 400 }
    );
  }

  const { data: maxRow } = await supabase
    .from("user_calendar_todo_sections")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder =
    typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .insert({
      user_id: user.id,
      title,
      sort_order: sortOrder,
    })
    .select(CALENDAR_SECTIONS_SELECT)
    .single();

  if (error || !data) {
    console.error("[calendar sections POST]", error);
    return NextResponse.json(
      { error: "Could not create section." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    section: mapSectionRow(data as Parameters<typeof mapSectionRow>[0]),
  });
}
