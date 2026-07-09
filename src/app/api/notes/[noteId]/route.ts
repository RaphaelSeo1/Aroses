import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

type Params = { params: Promise<{ noteId: string }> };

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * GET /api/notes/[noteId] — standalone note doc.
 * PUT — upsert content (NotesPanel contract).
 * PATCH — update title only.
 * DELETE — remove note.
 */
export async function GET(_req: Request, ctx: Params) {
  const { noteId } = await ctx.params;
  if (!isUuid(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_notes")
    .select(
      "id, title, content_json, content_text, course_id, ingest_job_id, updated_at"
    )
    .eq("id", noteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[notes GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    notes: {
      title: data.title,
      contentJson: data.content_json ?? EMPTY_DOC,
      contentText: data.content_text ?? "",
      autoGenerate: false,
      updatedAt: data.updated_at,
      courseId: data.course_id,
      ingestJobId: data.ingest_job_id,
    },
  });
}

export async function PUT(request: Request, ctx: Params) {
  const { noteId } = await ctx.params;
  if (!isUuid(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  let body: { contentJson?: unknown; contentText?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.contentJson || typeof body.contentJson !== "object") {
    return NextResponse.json({ error: "Missing contentJson." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const text =
    typeof body.contentText === "string"
      ? body.contentText.slice(0, 50_000)
      : "";

  const patch: Record<string, unknown> = {
    content_json: body.contentJson,
    content_text: text,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 200);
  }

  const { data, error } = await supabase
    .from("user_notes")
    .update(patch)
    .eq("id", noteId)
    .eq("user_id", user.id)
    .select("title, content_json, content_text, updated_at, course_id, ingest_job_id")
    .maybeSingle();

  if (error) {
    console.error("[notes PUT]", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    notes: {
      title: data.title,
      contentJson: data.content_json,
      contentText: data.content_text,
      autoGenerate: false,
      updatedAt: data.updated_at,
      courseId: data.course_id,
      ingestJobId: data.ingest_job_id,
    },
  });
}

export async function PATCH(request: Request, ctx: Params) {
  const { noteId } = await ctx.params;
  if (!isUuid(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  let body: { title?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_notes")
    .update({
      title: body.title.trim().slice(0, 200),
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("user_id", user.id)
    .select("title, updated_at")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Update failed" }, { status: 404 });
  }
  return NextResponse.json({ title: data.title, updatedAt: data.updated_at });
}

export async function DELETE(_req: Request, ctx: Params) {
  const { noteId } = await ctx.params;
  if (!isUuid(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[notes DELETE]", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
