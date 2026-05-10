import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { schedulePersonalCard } from "@/lib/srs-sm2";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    materialId?: string;
    moduleId?: number;
    quizQuestionIndex?: number;
    questionIndex?: number;
    personalItemId?: string;
    selectedChoice?: number;
    isCorrect?: boolean;
    /** When set to "free", selected_choice is stored as 4 = wrong, 5 = correct */
    responseKind?: string;
  };

  if (typeof b.materialId !== "string" || typeof b.isCorrect !== "boolean") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const isFree = b.responseKind === "free";

  let selectedChoice: number;
  if (isFree) {
    selectedChoice = b.isCorrect ? 5 : 4;
  } else {
    if (typeof b.selectedChoice !== "number") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    selectedChoice = b.selectedChoice;
    if (selectedChoice < 0 || selectedChoice > 3) {
      return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
    }
  }

  const { data: matRow } = await supabase
    .from("study_materials")
    .select("id")
    .eq("id", b.materialId)
    .maybeSingle();

  if (!matRow) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!user) {
    return NextResponse.json({ ok: true, saved: false });
  }

  if (
    typeof b.personalItemId === "string" &&
    UUID_RE.test(b.personalItemId)
  ) {
    const { data: item } = await supabase
      .from("user_personal_quiz_items")
      .select("id")
      .eq("id", b.personalItemId)
      .eq("user_id", user.id)
      .eq("material_id", b.materialId)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const { error } = await supabase.from("user_personal_question_attempts").insert({
      user_id: user.id,
      personal_item_id: b.personalItemId,
      selected_choice: selectedChoice,
      is_correct: b.isCorrect,
    });

    if (error) {
      console.error(error);
      return NextResponse.json(
        { error: "Could not save attempt." },
        { status: 500 }
      );
    }

    const { data: card } = await supabase
      .from("user_personal_quiz_items")
      .select("srs_ease, srs_interval_days, srs_reps")
      .eq("id", b.personalItemId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (card) {
      const prev = {
        ease: Number(card.srs_ease) || 2.5,
        intervalDays: Number(card.srs_interval_days) || 0,
        reps: Number(card.srs_reps) || 0,
      };
      const { next, dueAt } = schedulePersonalCard(prev, b.isCorrect, new Date());
      const { error: srsErr } = await supabase
        .from("user_personal_quiz_items")
        .update({
          srs_ease: next.ease,
          srs_interval_days: next.intervalDays,
          srs_reps: next.reps,
          due_at: dueAt.toISOString(),
        })
        .eq("id", b.personalItemId)
        .eq("user_id", user.id);

      if (srsErr) {
        console.error("[personal SRS update]", srsErr);
      }
    }

    return NextResponse.json({ ok: true });
  }

  let questionIndex: number;
  if (
    typeof b.moduleId === "number" &&
    Number.isFinite(b.moduleId) &&
    typeof b.quizQuestionIndex === "number"
  ) {
    questionIndex = b.moduleId * 1000 + b.quizQuestionIndex;
  } else if (typeof b.questionIndex === "number") {
    questionIndex = b.questionIndex;
  } else {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { error } = await supabase.from("question_attempts").insert({
    user_id: user.id,
    material_id: b.materialId,
    question_index: questionIndex,
    selected_choice: selectedChoice,
    is_correct: b.isCorrect,
  });

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not save attempt." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
