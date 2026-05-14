import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
    title?: string;
    description?: string;
    is_self_study?: boolean;
    study_context?: string;
  };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const description =
    typeof b.description === "string" ? b.description.trim() : "";
  const isSelfStudy = Boolean(b.is_self_study);
  const studyContext =
    typeof b.study_context === "string" && b.study_context.trim().length > 0
      ? b.study_context.trim().slice(0, 4000)
      : null;

  if (title.length < 2) {
    return NextResponse.json(
      { error: "Please enter a course title (at least 2 characters)." },
      { status: 400 }
    );
  }

  const { data: maxRow } = await supabase
    .from("courses")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder =
    typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

  const { data: row, error } = await supabase
    .from("courses")
    .insert({
      user_id: user.id,
      title,
      description,
      sort_order: nextOrder,
      is_self_study: isSelfStudy,
      ...(studyContext ? { study_context: studyContext } : {}),
    })
    .select("id")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not create course." },
      { status: 500 }
    );
  }

  return NextResponse.json({ courseId: row.id });
}
