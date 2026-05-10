import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
