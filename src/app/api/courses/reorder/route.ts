import { NextResponse } from "next/server";
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

  const courseIds = (body as { courseIds?: unknown }).courseIds;
  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    return NextResponse.json({ error: "courseIds must be a non-empty array." }, { status: 400 });
  }

  const ids = courseIds.filter((id): id is string => typeof id === "string");
  if (ids.length !== courseIds.length || ids.some((id) => !UUID_RE.test(id))) {
    return NextResponse.json({ error: "Invalid courseIds." }, { status: 400 });
  }

  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    return NextResponse.json({ error: "Duplicate course ids." }, { status: 400 });
  }

  const { data: rows, error: fetchErr } = await supabase
    .from("courses")
    .select("id")
    .in("id", ids);

  if (fetchErr) {
    console.error(fetchErr);
    return NextResponse.json({ error: "Could not verify courses." }, { status: 500 });
  }

  if (!rows || rows.length !== ids.length) {
    return NextResponse.json(
      { error: "Some courses were not found or are not yours." },
      { status: 403 }
    );
  }

  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from("courses")
      .update({ sort_order: i })
      .eq("id", ids[i]);
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Could not save order." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
