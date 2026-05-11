import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function friendlyExamGroupError(error: PostgrestError): string {
  const msg = error.message ?? "";
  const combined = `${msg} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (
    combined.includes("exam_groups") &&
    (combined.includes("does not exist") ||
      combined.includes("schema cache") ||
      combined.includes("Could not find the table"))
  ) {
    return "Database is missing the exam_groups table. In Supabase → SQL Editor, run migrations 004_exam_groups.sql then 005_exam_groups_grants.sql from your repo.";
  }
  if (
    error.code === "42501" ||
    combined.toLowerCase().includes("row-level security") ||
    combined.toLowerCase().includes("violates row-level security")
  ) {
    return "Could not save the section (permission denied). Try signing out and back in.";
  }
  return "Could not create section.";
}

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

  const b = body as { courseId?: string; name?: string };
  if (typeof b.courseId !== "string" || !UUID_RE.test(b.courseId)) {
    return NextResponse.json({ error: "Invalid courseId" }, { status: 400 });
  }

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json(
      { error: "Section name must be 1–120 characters." },
      { status: 400 }
    );
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", b.courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const reader = admin ?? supabase;

  const { data: maxRow, error: maxErr } = await reader
    .from("exam_groups")
    .select("sort_order")
    .eq("course_id", b.courseId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) {
    console.error(maxErr);
    return NextResponse.json(
      {
        error: friendlyExamGroupError(maxErr),
        ...(process.env.NODE_ENV === "development" && {
          debug: maxErr.message,
        }),
      },
      { status: 500 }
    );
  }

  const nextOrder =
    typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

  const insertPayload = {
    course_id: b.courseId,
    user_id: user.id,
    name,
    sort_order: nextOrder,
  };

  let row: { id: string } | null = null;
  let insertError: PostgrestError | null = null;

  if (admin) {
    const ins = await admin
      .from("exam_groups")
      .insert(insertPayload)
      .select("id")
      .single();
    if (!ins.error && ins.data) {
      row = ins.data;
    } else {
      insertError = ins.error;
      console.warn("Service-role exam_groups insert failed, retrying with session:", ins.error);
    }
  }

  if (!row) {
    const ins = await supabase
      .from("exam_groups")
      .insert(insertPayload)
      .select("id")
      .single();
    row = ins.data;
    insertError = ins.error;
  }

  if (insertError || !row) {
    console.error(insertError);
    return NextResponse.json(
      {
        error: insertError
          ? friendlyExamGroupError(insertError)
          : "Could not create section.",
        ...(process.env.NODE_ENV === "development" &&
          insertError && { debug: insertError.message }),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ groupId: row.id });
}
