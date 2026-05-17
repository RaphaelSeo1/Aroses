import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type { CourseMode } from "@/types/mentored";

/**
 * GET  /api/mentored/mode/[materialId]
 *   { mode: "mentored" | "free" } — defaults to "mentored" if no row yet.
 *
 * PUT  /api/mentored/mode/[materialId]
 *   Body: { mode: "mentored" | "free" }
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

function parseMode(value: unknown): CourseMode | null {
  return value === "mentored" || value === "free" ? value : null;
}

export async function GET(_request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("user_course_mode_prefs")
    .select("mode")
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    console.error("[mentored/mode GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }

  // New courses default to Mentored.
  const mode: CourseMode =
    data && typeof data.mode === "string" && data.mode === "free"
      ? "free"
      : "mentored";

  return NextResponse.json({ mode });
}

export async function PUT(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  let body: { mode?: unknown };
  try {
    body = (await request.json()) as { mode?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = parseMode(body.mode);
  if (!mode) {
    return NextResponse.json(
      { error: "mode must be 'mentored' or 'free'." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("user_course_mode_prefs")
    .upsert(
      {
        user_id: user.id,
        material_id: materialId,
        mode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,material_id" }
    );

  if (error) {
    console.error("[mentored/mode PUT]", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({ mode });
}
