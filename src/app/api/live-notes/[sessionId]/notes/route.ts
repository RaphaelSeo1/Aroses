import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ sessionId: string }> };

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * GET /api/live-notes/[sessionId]/notes
 *   Returns the live notes TipTap doc (JSON) for this capture session.
 *
 * PUT /api/live-notes/[sessionId]/notes
 *   Upserts the notes. Body: { contentJson, contentText, autoGenerate? }.
 *
 * Mirrors /api/tutor-session/[sessionId]/notes so the reused NotesPanel
 * component can point here via its `notesEndpoint` prop. Live Notes has no
 * persisted auto-generate flag (AI appending is the whole feature); the field
 * is accepted and echoed for prop compatibility.
 */
export async function GET(_req: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("live_lecture_sessions")
    .select("notes_json, notes_text, updated_at, user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    console.error("[live-notes notes GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    notes: {
      contentJson: data.notes_json ?? EMPTY_DOC,
      contentText: data.notes_text ?? "",
      autoGenerate: true,
      updatedAt: data.updated_at,
    },
  });
}

export async function PUT(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  let body: {
    contentJson?: unknown;
    contentText?: string;
    autoGenerate?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.contentJson || typeof body.contentJson !== "object") {
    return NextResponse.json({ error: "Missing contentJson." }, { status: 400 });
  }
  try {
    const size = JSON.stringify(body.contentJson).length;
    if (size > 1_500_000) {
      return NextResponse.json({ error: "Notes too large." }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const text =
    typeof body.contentText === "string"
      ? body.contentText.slice(0, 100_000)
      : "";

  const { data, error } = await supabase
    .from("live_lecture_sessions")
    .update({
      notes_json: body.contentJson,
      notes_text: text,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .select("notes_json, notes_text, updated_at")
    .maybeSingle();

  if (error) {
    console.error("[live-notes notes PUT]", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    notes: {
      contentJson: data.notes_json,
      contentText: data.notes_text,
      autoGenerate: true,
      updatedAt: data.updated_at,
    },
  });
}
