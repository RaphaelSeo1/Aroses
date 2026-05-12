import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const moduleId = Number(searchParams.get("moduleId"));
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "moduleId required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ missedPersonalItemIds: [] });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data: items, error: ie } = await supabase
    .from("user_personal_quiz_items")
    .select("id")
    .eq("material_id", materialId)
    .eq("module_id", moduleId);

  if (ie) {
    console.error(ie);
    return NextResponse.json({ error: "Could not load items." }, { status: 500 });
  }

  const ids = (items ?? []).map((r) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ missedPersonalItemIds: [] });
  }

  const { data: rows, error } = await supabase
    .from("user_personal_question_attempts")
    .select("personal_item_id, is_correct, answered_at")
    .in("personal_item_id", ids)
    .order("answered_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not load attempts." }, { status: 500 });
  }

  const latestOk = new Map<string, boolean>();
  for (const r of rows ?? []) {
    const pid = r.personal_item_id as string;
    if (!latestOk.has(pid)) {
      latestOk.set(pid, r.is_correct);
    }
  }

  const missed: string[] = [];
  for (const [pid, ok] of latestOk) {
    if (!ok) missed.push(pid);
  }

  return NextResponse.json({
    missedPersonalItemIds: missed.sort(),
  });
}
