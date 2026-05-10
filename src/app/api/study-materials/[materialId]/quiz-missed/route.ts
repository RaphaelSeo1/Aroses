import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
    return NextResponse.json({
      missedQuizIndices: [],
      everWrongQuizIndices: [],
      attemptCount: 0,
    });
  }

  const { data: rows, error } = await supabase
    .from("question_attempts")
    .select("question_index, is_correct, answered_at")
    .eq("material_id", materialId)
    .eq("user_id", user.id)
    .order("answered_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not load attempts." },
      { status: 500 }
    );
  }

  /** Quiz indices in this module that still need practice (not mastered on latest try). */
  const latestByKey = new Map<number, boolean>();
  for (const r of rows ?? []) {
    const { moduleId: mod, quizIndex } = decodeModuleAndQuiz(r.question_index);
    if (mod !== moduleId) continue;
    if (!latestByKey.has(r.question_index)) {
      latestByKey.set(r.question_index, r.is_correct);
    }
  }

  const missedQuizIndices = new Set<number>();
  const everWrong = new Set<number>();

  for (const r of rows ?? []) {
    const { moduleId: mod, quizIndex } = decodeModuleAndQuiz(r.question_index);
    if (mod !== moduleId) continue;
    if (!r.is_correct) everWrong.add(quizIndex);
  }

  for (const [qKey, ok] of latestByKey) {
    const { moduleId: mod, quizIndex } = decodeModuleAndQuiz(qKey);
    if (mod !== moduleId) continue;
    if (!ok) missedQuizIndices.add(quizIndex);
  }

  return NextResponse.json({
    missedQuizIndices: [...missedQuizIndices].sort((a, b) => a - b),
    everWrongQuizIndices: [...everWrong].sort((a, b) => a - b),
    attemptCount: rows?.length ?? 0,
  });
}
