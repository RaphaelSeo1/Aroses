import { NextResponse } from "next/server";
import {
  deleteTodoSection,
  updateTodoSectionTitle,
} from "@/lib/calendar/queries";
import { parseSectionTitle } from "@/lib/calendar/sections";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";

type Params = { params: Promise<{ sectionId: string }> };

/**
 * PATCH /api/calendar/sections/[sectionId] — rename a to-do section.
 * DELETE — remove it; tasks move back to General.
 */
export async function PATCH(request: Request, ctx: Params) {
  const { sectionId } = await ctx.params;
  if (!isUuid(sectionId)) {
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

  const title = parseSectionTitle((body as { title?: unknown }).title);
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const { section, error } = await updateTodoSectionTitle(
    supabase,
    user.id,
    sectionId,
    title
  );
  if (error) {
    console.error("[calendar sections PATCH]", error);
    return NextResponse.json(
      { error: "Could not rename section." },
      { status: 500 }
    );
  }
  if (!section) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ section });
}

export async function DELETE(_request: Request, ctx: Params) {
  const { sectionId } = await ctx.params;
  if (!isUuid(sectionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok, error } = await deleteTodoSection(supabase, user.id, sectionId);
  if (error) {
    console.error("[calendar sections DELETE]", error);
    return NextResponse.json(
      { error: "Could not remove section." },
      { status: 500 }
    );
  }
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
