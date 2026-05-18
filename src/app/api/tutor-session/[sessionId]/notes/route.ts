import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/tutor-session/[sessionId]/notes
 *   Returns the live notes TipTap doc (JSON) for this session.
 *
 * PUT /api/tutor-session/[sessionId]/notes
 *   Upserts the live notes. Body: { contentJson, contentText }.
 *
 * Mirrors the shape of /api/mentored/notes/[materialId] so the
 * reused NotesPanel component can swap endpoints via props.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export async function GET(_req: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data } = await supabase
    .from("tutor_sessions")
    .select("live_notes_json, live_notes_text, updated_at, user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    notes: {
      contentJson: data.live_notes_json ?? EMPTY_DOC,
      contentText: data.live_notes_text ?? "",
      // No autoGenerate concept on tutor sessions (the auto-gen
      // toggle is per-material on the mentored path); we always
      // return false so the NotesPanel toggle stays in sync.
      autoGenerate: false,
      updatedAt: data.updated_at,
    },
  });
}

export async function PUT(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  let body: {
    contentJson?: unknown;
    contentText?: string;
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Ownership check via UPDATE WHERE — RLS already enforces it but
  // we want a clean 404 vs 200 result.
  const text =
    typeof body.contentText === "string"
      ? body.contentText.slice(0, 50_000)
      : "";

  const { data, error } = await supabase
    .from("tutor_sessions")
    .update({
      live_notes_json: body.contentJson,
      live_notes_text: text,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .select("live_notes_json, live_notes_text, updated_at")
    .maybeSingle();

  if (error) {
    console.error("[tutor-session notes PUT]", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    notes: {
      contentJson: data.live_notes_json,
      contentText: data.live_notes_text,
      autoGenerate: false,
      updatedAt: data.updated_at,
    },
  });
}
