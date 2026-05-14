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
  let title = typeof b.title === "string" ? b.title.trim() : "";
  const description =
    typeof b.description === "string" ? b.description.trim() : "";
  const isSelfStudy = Boolean(b.is_self_study);
  const studyContext =
    typeof b.study_context === "string" && b.study_context.trim().length > 0
      ? b.study_context.trim().slice(0, 4000)
      : null;

  // Self-study sessions don't require a title; we generate a friendly default
  // like "Self study · May 14" so the workspace header reads cleanly. The user
  // can rename it later.
  if (isSelfStudy && title.length < 2) {
    title = `Self study · ${new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`;
  }

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

  // Try inserting with self-study columns. If the migration hasn't been
  // applied yet (column doesn't exist → code 42703), fall back to the
  // base columns so course creation never hard-fails.
  let row: { id: string } | null = null;

  const { data: rowFull, error: errFull } = await supabase
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

  if (errFull) {
    const isSchemaErr =
      errFull.code === "42703" ||
      (errFull.message ?? "").includes("is_self_study") ||
      (errFull.message ?? "").includes("study_context") ||
      (errFull.message ?? "").includes("schema cache");

    if (!isSchemaErr) {
      console.error("[POST /api/courses]", errFull);
      return NextResponse.json(
        { error: "Could not create course." },
        { status: 500 }
      );
    }

    // Migration not yet applied — create without the new columns.
    console.warn("[POST /api/courses] self-study columns missing; creating without them");
    const { data: rowFallback, error: errFallback } = await supabase
      .from("courses")
      .insert({ user_id: user.id, title, description, sort_order: nextOrder })
      .select("id")
      .single();

    if (errFallback || !rowFallback) {
      console.error("[POST /api/courses] fallback", errFallback);
      return NextResponse.json(
        { error: "Could not create course." },
        { status: 500 }
      );
    }
    row = rowFallback;
  } else {
    row = rowFull;
  }

  return NextResponse.json({ courseId: row!.id });
}
