import { NextResponse } from "next/server";
import {
  loadCourseProgress,
  upsertCourseProgress,
} from "@/lib/course-progress/db";
import { createClient } from "@/lib/supabase/server";
import type { CourseProgressPatch } from "@/types/course-progress";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_req: Request, ctx: Params) {
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

  const progress = await loadCourseProgress(supabase, user.id, courseId);
  return NextResponse.json({ progress });
}

export async function PUT(request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  let body: CourseProgressPatch;
  try {
    body = (await request.json()) as CourseProgressPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const progress = await upsertCourseProgress(supabase, user.id, courseId, body);
  if (!progress) {
    return NextResponse.json({ error: "Could not save progress." }, { status: 500 });
  }

  return NextResponse.json({ progress });
}
