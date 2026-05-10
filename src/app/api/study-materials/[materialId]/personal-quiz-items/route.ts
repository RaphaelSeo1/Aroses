import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type { CourseQuizItem } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const moduleId = Number(searchParams.get("moduleId"));
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "moduleId required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ items: [] });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("user_personal_quiz_items")
    .select(
      "id, item, created_at, due_at, srs_ease, srs_interval_days, srs_reps"
    )
    .eq("material_id", materialId)
    .eq("module_id", moduleId)
    .eq("user_id", user.id)
    .order("due_at", { ascending: true });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }

  return NextResponse.json({
    items: (data ?? []).map((r) => ({
      id: r.id,
      item: r.item as CourseQuizItem,
      created_at: r.created_at,
      due_at: r.due_at as string,
      srs_ease: r.srs_ease as number,
      srs_interval_days: r.srs_interval_days as number,
      srs_reps: r.srs_reps as number,
    })),
  });
}
