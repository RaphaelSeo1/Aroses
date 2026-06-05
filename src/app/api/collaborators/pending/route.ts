import { NextResponse } from "next/server";
import { enrichCollaboratorRows } from "@/lib/collaboration/serialize-collaborators";
import { createClient } from "@/lib/supabase/server";

/** GET — pending course invites for the signed-in user. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const email = user.email?.trim().toLowerCase() ?? "";

  const [byUserRes, byEmailRes] = await Promise.all([
    supabase
      .from("course_collaborators")
      .select(
        "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
      )
      .eq("status", "pending")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    email
      ? supabase
          .from("course_collaborators")
          .select(
            "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
          )
          .eq("status", "pending")
          .is("user_id", null)
          .ilike("invited_email", email)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = byUserRes.error ?? byEmailRes.error;
  type PendingRow = NonNullable<typeof byUserRes.data>[number];
  const merged = new Map<string, PendingRow>();
  for (const row of [...(byUserRes.data ?? []), ...(byEmailRes.data ?? [])]) {
    merged.set(row.id, row);
  }
  const rows = [...merged.values()];

  if (error) {
    const msg = error.message ?? "";
    if (error.code === "42P01" || msg.includes("course_collaborators")) {
      return NextResponse.json({ invites: [] });
    }
    console.error("[collaborators/pending GET]", error);
    return NextResponse.json(
      { error: "Could not load invites." },
      { status: 500 }
    );
  }

  const filtered = (rows ?? []).filter((row) => {
    if (row.user_id === user.id) return true;
    if (!row.user_id && email && row.invited_email) {
      return row.invited_email.trim().toLowerCase() === email;
    }
    return false;
  });

  const enriched = await enrichCollaboratorRows(supabase, filtered);

  const courseIds = [...new Set(filtered.map((r) => r.course_id))];
  const courseTitleById = new Map<string, string>();

  if (courseIds.length > 0) {
    const { data: courses } = await supabase
      .from("courses")
      .select("id, title")
      .in("id", courseIds);

    for (const c of courses ?? []) {
      courseTitleById.set(c.id, c.title);
    }
  }

  const invites = enriched.map((item, i) => ({
    ...item,
    courseId: filtered[i]!.course_id,
    courseTitle: courseTitleById.get(filtered[i]!.course_id) ?? "Untitled course",
  }));

  return NextResponse.json({ invites });
}
