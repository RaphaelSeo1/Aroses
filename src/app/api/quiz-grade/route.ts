import { NextResponse } from "next/server";
import { gradeFreeResponseWithAi } from "@/lib/ai/grade-free-response";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
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
    question?: string;
    referenceAnswer?: string;
    studentAnswer?: string;
  };

  if (typeof b.materialId !== "string" || !UUID_RE.test(b.materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("study_materials")
    .select("id")
    .eq("id", b.materialId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const question = typeof b.question === "string" ? b.question.trim() : "";
  const referenceAnswer =
    typeof b.referenceAnswer === "string" ? b.referenceAnswer.trim() : "";
  const studentAnswer =
    typeof b.studentAnswer === "string" ? b.studentAnswer.trim() : "";

  if (question.length < 4 || referenceAnswer.length < 8) {
    return NextResponse.json({ error: "Invalid question payload." }, { status: 400 });
  }
  if (studentAnswer.length < 2) {
    return NextResponse.json(
      { error: "Write an answer before submitting." },
      { status: 400 }
    );
  }
  if (studentAnswer.length > 12_000) {
    return NextResponse.json({ error: "Answer too long." }, { status: 400 });
  }

  try {
    const result = await gradeFreeResponseWithAi({
      question,
      referenceAnswer,
      studentAnswer,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Could not grade this answer. Try again shortly." },
      { status: 502 }
    );
  }
}
