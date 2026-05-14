import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ courseId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** PATCH /api/courses/[courseId]/study-context — update the self-study description. */
export async function PATCH(request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const b = body as { study_context?: string };
  const studyContext =
    typeof b.study_context === "string" && b.study_context.trim().length > 0
      ? b.study_context.trim().slice(0, 4000)
      : null;

  const { error } = await supabase
    .from("courses")
    .update({ study_context: studyContext })
    .eq("id", courseId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[study-context] update", error);
    return NextResponse.json(
      { error: "Could not update study context." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
