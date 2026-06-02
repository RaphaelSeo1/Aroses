import { NextResponse } from "next/server";
import { resolveForumAuthorName } from "@/lib/forum/author-name";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isForumCategory } from "@/types/forum";

const TITLE_MAX = 140;
const BODY_MAX = 8000;

export async function POST(request: Request) {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to post." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { title?: unknown; body?: unknown; category?: unknown };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const postBody = typeof b.body === "string" ? b.body.trim() : "";
  const category = isForumCategory(b.category) ? b.category : "discussion";

  if (title.length < 3) {
    return NextResponse.json(
      { error: "Give your post a title (at least 3 characters)." },
      { status: 400 }
    );
  }
  if (title.length > TITLE_MAX) {
    return NextResponse.json(
      { error: `Title is too long (max ${TITLE_MAX} characters).` },
      { status: 400 }
    );
  }
  if (postBody.length > BODY_MAX) {
    return NextResponse.json(
      { error: "Post body is too long." },
      { status: 400 }
    );
  }

  const authorName = await resolveForumAuthorName(supabase, user);

  const { data: post, error } = await supabase
    .from("forum_posts")
    .insert({
      user_id: user.id,
      author_name: authorName,
      category,
      title,
      body: postBody,
    })
    .select("id, user_id, author_name, category, title, body, vote_count, comment_count, pinned, view_count, created_at")
    .single();

  if (error || !post) {
    console.error("[forum] create post failed", error);
    return NextResponse.json(
      { error: "Could not create post. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ post });
}
