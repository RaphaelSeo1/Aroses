import { NextResponse } from "next/server";
import { dismissStudyCourse } from "@/lib/study-course-dismiss";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function POST(_req: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: courseRow, error: courseErr } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();

  if (courseErr || !courseRow) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  const ok = await dismissStudyCourse(supabase, user.id, courseId);
  if (!ok) {
    return NextResponse.json(
      { error: "Could not remove course from your study list." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
