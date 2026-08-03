import { NextResponse } from "next/server";
import { assertCanCreateCourse } from "@/lib/billing/course-cap";
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
    section_name?: string;
  };
  let title = typeof b.title === "string" ? b.title.trim() : "";
  const description =
    typeof b.description === "string" ? b.description.trim() : "";
  const isSelfStudy = Boolean(b.is_self_study);
  const studyContext =
    typeof b.study_context === "string" && b.study_context.trim().length > 0
      ? b.study_context.trim().slice(0, 4000)
      : null;
  // Optional name for the auto-created materials folder/section. Mainly used
  // by self-study so the user picks the tab label instead of getting the
  // hardcoded "My materials" default.
  const sectionName =
    typeof b.section_name === "string" && b.section_name.trim().length > 0
      ? b.section_name.trim().slice(0, 80)
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

  const cap = await assertCanCreateCourse(user.id);
  if (!cap.ok) {
    return NextResponse.json(
      { error: cap.error, code: cap.code, used: cap.used, cap: cap.cap },
      { status: cap.status }
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
      const msg = errFull.message ?? "";
      if (/course_cap_reached/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "You've reached your plan's course limit. Delete a course or upgrade to create another.",
            code: "course_cap_reached",
          },
          { status: 402 }
        );
      }
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

  // If the caller picked a section name (self-study with custom label),
  // seed the first exam_group here so the workspace doesn't fall back to
  // the hardcoded "My materials" default.
  if (row && sectionName) {
    const { error: groupErr } = await supabase
      .from("exam_groups")
      .insert({
        course_id: row.id,
        user_id: user.id,
        name: sectionName,
        sort_order: 0,
      });
    if (groupErr) {
      // Non-fatal: the workspace page will fall back to creating a default
      // section on first render. Log so we can spot recurring failures.
      console.warn("[POST /api/courses] could not seed section", groupErr);
    }
  }

  return NextResponse.json({ courseId: row!.id });
}
