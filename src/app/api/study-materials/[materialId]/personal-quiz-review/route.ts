import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type { QuizReviewStatsDto } from "@/types/quiz-review";

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
    return NextResponse.json({ byItemId: {} });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data: items, error: ie } = await supabase
    .from("user_personal_quiz_items")
    .select("id")
    .eq("material_id", materialId)
    .eq("module_id", moduleId)
    .eq("user_id", user.id);

  if (ie) {
    console.error(ie);
    return NextResponse.json({ error: "Could not load items." }, { status: 500 });
  }

  const ids = (items ?? []).map((r) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ byItemId: {} });
  }

  const { data: rows, error } = await supabase
    .from("user_personal_question_attempts")
    .select("personal_item_id, is_correct, answered_at, selected_choice")
    .eq("user_id", user.id)
    .in("personal_item_id", ids)
    .order("answered_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not load attempts." }, { status: 500 });
  }

  const latestByItem = new Map<
    string,
    {
      is_correct: boolean;
      answered_at: string;
      selected_choice: number;
    }
  >();
  const attemptCount = new Map<string, number>();
  const everCorrect = new Set<string>();

  for (const r of rows ?? []) {
    const id = r.personal_item_id as string;
    attemptCount.set(id, (attemptCount.get(id) ?? 0) + 1);
    if (r.is_correct) everCorrect.add(id);
    if (!latestByItem.has(id)) {
      latestByItem.set(id, {
        is_correct: r.is_correct,
        answered_at: r.answered_at,
        selected_choice: r.selected_choice,
      });
    }
  }

  const byItemId: Record<string, QuizReviewStatsDto> = {};
  for (const [id, row] of latestByItem) {
    byItemId[id] = {
      lastIsCorrect: row.is_correct,
      lastAttemptAt: row.answered_at,
      attemptCount: attemptCount.get(id) ?? 0,
      everCorrect: everCorrect.has(id),
      lastSelectedChoice: row.selected_choice,
    };
  }

  return NextResponse.json({ byItemId });
}
