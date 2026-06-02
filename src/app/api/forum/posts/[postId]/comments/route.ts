import { NextResponse } from "next/server";
import { resolveForumAuthorName } from "@/lib/forum/author-name";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

const COMMENT_MAX = 4000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to comment." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = typeof (raw as { body?: unknown }).body === "string"
    ? (raw as { body: string }).body.trim()
    : "";

  if (body.length < 1) {
    return NextResponse.json({ error: "Write something first." }, { status: 400 });
  }
  if (body.length > COMMENT_MAX) {
    return NextResponse.json({ error: "Comment is too long." }, { status: 400 });
  }

  const authorName = await resolveForumAuthorName(supabase, user);

  const { data: comment, error } = await supabase
    .from("forum_comments")
    .insert({
      post_id: postId,
      user_id: user.id,
      author_name: authorName,
      body,
    })
    .select("id, post_id, user_id, author_name, body, created_at")
    .single();

  if (error || !comment) {
    console.error("[forum] create comment failed", error);
    return NextResponse.json(
      { error: "Could not post comment. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ comment });
}
