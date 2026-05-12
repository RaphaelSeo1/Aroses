import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { QuizReviewStatsDto } from "@/types/quiz-review";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

/** Decode question_attempts.question_index = moduleId * 1000 + quizIndex */
function decodeModuleAndQuiz(questionIndex: number): {
  moduleId: number;
  quizIndex: number;
} {
  const moduleId = Math.floor(questionIndex / 1000);
  const quizIndex = questionIndex % 1000;
  return { moduleId, quizIndex };
}

export async function GET(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const moduleIdParam = searchParams.get("moduleId");
  const moduleId = moduleIdParam != null ? Number(moduleIdParam) : Number.NaN;
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json(
      { error: "Query moduleId is required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ byQuizIndex: {} });
  }

  const { data: rows, error } = await supabase
    .from("question_attempts")
    .select("question_index, is_correct, answered_at, selected_choice")
    .eq("material_id", materialId)
    .order("answered_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not load attempts." },
      { status: 500 }
    );
  }

  const latestByQuiz = new Map<
    number,
    {
      is_correct: boolean;
      answered_at: string;
      selected_choice: number;
    }
  >();
  const attemptCount = new Map<number, number>();
  const everCorrect = new Set<number>();

  for (const r of rows ?? []) {
    const { moduleId: mod, quizIndex } = decodeModuleAndQuiz(r.question_index);
    if (mod !== moduleId) continue;

    attemptCount.set(quizIndex, (attemptCount.get(quizIndex) ?? 0) + 1);
    if (r.is_correct) everCorrect.add(quizIndex);
    if (!latestByQuiz.has(quizIndex)) {
      latestByQuiz.set(quizIndex, {
        is_correct: r.is_correct,
        answered_at: r.answered_at,
        selected_choice: r.selected_choice,
      });
    }
  }

  const byQuizIndex: Record<string, QuizReviewStatsDto> = {};
  for (const [qi, row] of latestByQuiz) {
    byQuizIndex[String(qi)] = {
      lastIsCorrect: row.is_correct,
      lastAttemptAt: row.answered_at,
      attemptCount: attemptCount.get(qi) ?? 0,
      everCorrect: everCorrect.has(qi),
      lastSelectedChoice: row.selected_choice,
    };
  }

  return NextResponse.json({ byQuizIndex });
}
