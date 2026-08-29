import { NextResponse } from "next/server";
import { insertTodoSection } from "@/lib/calendar/queries";
import { parseSectionTitle } from "@/lib/calendar/sections";
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

  const title =
    parseSectionTitle((body as { title?: unknown })?.title) ?? "New section";

  const { section, error, tooMany } = await insertTodoSection(
    supabase,
    user.id,
    title
  );
  if (tooMany) {
    return NextResponse.json({ error: "Too many sections." }, { status: 400 });
  }
  if (error || !section) {
    console.error("[calendar sections POST]", error);
    return NextResponse.json(
      {
        error:
          typeof error?.message === "string" && error.message.trim()
            ? error.message
            : "Could not create that section.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ section });
}
