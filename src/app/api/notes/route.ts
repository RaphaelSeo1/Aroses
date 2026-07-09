import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * POST /api/notes — create a blank standalone note.
 * Body: { title?: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const title =
    typeof (body as { title?: unknown }).title === "string" &&
    (body as { title: string }).title.trim()
      ? (body as { title: string }).title.trim().slice(0, 200)
      : "Untitled note";

  const rawSectionId = (body as { sectionId?: unknown }).sectionId;
  let sectionId: string | null = null;
  if (rawSectionId === null) {
    sectionId = null;
  } else if (typeof rawSectionId === "string" && rawSectionId.trim()) {
    sectionId = rawSectionId.trim();
  }

  const insert: Record<string, unknown> = {
    user_id: user.id,
    title,
    content_json: EMPTY_DOC,
    content_text: "",
  };
  if (sectionId) {
    const { data: section } = await supabase
      .from("user_note_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (section) insert.section_id = sectionId;
  }

  const { data, error } = await supabase
    .from("user_notes")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    console.error("[notes POST]", error);
    return NextResponse.json(
      { error: "Could not create a note." },
      { status: 500 }
    );
  }

  return NextResponse.json({ noteId: data.id });
}
