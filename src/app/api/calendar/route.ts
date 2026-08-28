import { NextResponse } from "next/server";
import { parseCalendarInput } from "@/lib/calendar/items";
import {
  insertCalendarItem,
  loadUserCalendar,
  ownedSectionId,
} from "@/lib/calendar/queries";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";

/**
 * GET /api/calendar — list the signed-in user's calendar items and todo sections.
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

  const { items, sections, error } = await loadUserCalendar(supabase, user.id);

  if (error) {
    if (
      error.code === "42P01" ||
      /user_calendar_items/i.test(error.message ?? "")
    ) {
      return NextResponse.json({ items: [], sections });
    }
    console.error("[calendar GET]", error);
    return NextResponse.json(
      { error: "Could not load calendar." },
      { status: 500 }
    );
  }

  return NextResponse.json({ items, sections });
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

  if (input.sectionId) {
    const owned = await ownedSectionId(supabase, user.id, input.sectionId);
    if (!owned) {
      return NextResponse.json({ error: "Unknown section." }, { status: 400 });
    }
    input.sectionId = owned;
  }

  const { item, error } = await insertCalendarItem(supabase, user.id, input);
  if (error || !item) {
    console.error("[calendar POST]", error);
    return NextResponse.json(
      { error: "Could not add that." },
      { status: 500 }
    );
  }

  return NextResponse.json({ item });
}
