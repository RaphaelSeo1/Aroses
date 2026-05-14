import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ courseId: string; shareId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** DELETE — revoke a share link (owner only). */
export async function DELETE(_request: Request, ctx: Params) {
  const { courseId, shareId } = await ctx.params;
  if (!UUID_RE.test(courseId) || !UUID_RE.test(shareId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { error } = await supabase
    .from("course_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId)
    .eq("course_id", courseId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[share-links DELETE]", error);
    return NextResponse.json({ error: "Could not revoke link." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
