import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/srs/reset
 *
 * Clears SRS state so cards behave as if they were never reviewed.
 *
 * Body shape (one of):
 *   { kind: "module", materialId, questionIndex }   // single module card
 *   { kind: "module", materialId }                   // every module card in a material
 *   { kind: "personal", personalItemId }             // single personal card
 *   { kind: "personal", materialId }                 // every personal card in a material
 *   { kind: "all" }                                  // everything for this user
 *
 * History rows in `question_attempts` / `user_personal_question_attempts`
 * are intentionally NOT deleted — those stay as a permanent record. Only
 * the scheduling state is wiped, so the card appears "new" again.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  kind?: string;
  materialId?: string;
  questionIndex?: number;
  personalItemId?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let b: Body;
  try {
    b = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = b.kind;

  if (kind === "module") {
    // Single card
    if (
      typeof b.materialId === "string" &&
      UUID_RE.test(b.materialId) &&
      typeof b.questionIndex === "number"
    ) {
      const { error } = await supabase
        .from("user_module_card_srs")
        .delete()
        .eq("user_id", user.id)
        .eq("material_id", b.materialId)
        .eq("question_index", b.questionIndex);
      if (error) return errorResponse(error);
      return NextResponse.json({ ok: true, removed: "module-card" });
    }
    // Whole deck for a material
    if (typeof b.materialId === "string" && UUID_RE.test(b.materialId)) {
      const { error } = await supabase
        .from("user_module_card_srs")
        .delete()
        .eq("user_id", user.id)
        .eq("material_id", b.materialId);
      if (error) return errorResponse(error);
      return NextResponse.json({ ok: true, removed: "module-deck" });
    }
    return NextResponse.json(
      { error: "materialId required" },
      { status: 400 }
    );
  }

  if (kind === "personal") {
    // Single card
    if (
      typeof b.personalItemId === "string" &&
      UUID_RE.test(b.personalItemId)
    ) {
      const { error } = await supabase
        .from("user_personal_quiz_items")
        .update({
          srs_ease: 2.5,
          srs_interval_days: 0,
          srs_reps: 0,
          due_at: new Date().toISOString(),
          last_reviewed_at: null,
          review_history: [],
        })
        .eq("id", b.personalItemId)
        .eq("user_id", user.id);
      if (error) return errorResponse(error);
      return NextResponse.json({ ok: true, removed: "personal-card" });
    }
    // Whole deck for a material
    if (typeof b.materialId === "string" && UUID_RE.test(b.materialId)) {
      const { error } = await supabase
        .from("user_personal_quiz_items")
        .update({
          srs_ease: 2.5,
          srs_interval_days: 0,
          srs_reps: 0,
          due_at: new Date().toISOString(),
          last_reviewed_at: null,
          review_history: [],
        })
        .eq("user_id", user.id)
        .eq("material_id", b.materialId);
      if (error) return errorResponse(error);
      return NextResponse.json({ ok: true, removed: "personal-deck" });
    }
    return NextResponse.json(
      { error: "personalItemId or materialId required" },
      { status: 400 }
    );
  }

  if (kind === "all") {
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase
        .from("user_module_card_srs")
        .delete()
        .eq("user_id", user.id),
      supabase
        .from("user_personal_quiz_items")
        .update({
          srs_ease: 2.5,
          srs_interval_days: 0,
          srs_reps: 0,
          due_at: new Date().toISOString(),
          last_reviewed_at: null,
          review_history: [],
        })
        .eq("user_id", user.id),
    ]);
    if (e1 || e2) return errorResponse(e1 ?? e2);
    return NextResponse.json({ ok: true, removed: "all" });
  }

  return NextResponse.json(
    { error: "kind must be 'module', 'personal', or 'all'" },
    { status: 400 }
  );
}

function errorResponse(error: unknown) {
  console.error("[srs reset]", error);
  return NextResponse.json(
    { error: "Could not reset SRS state." },
    { status: 500 }
  );
}
