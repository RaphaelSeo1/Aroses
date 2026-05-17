import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  applyRating,
  SRS_DEFAULT_STATE,
  type SrsCardState,
  type SrsRating,
} from "@/lib/srs-sm2";

/**
 * POST /api/srs/rate
 *
 * Records a 4-button SRS rating for either:
 *   - a module-bank card  ({ kind: "module", materialId, questionIndex })
 *   - a personal card     ({ kind: "personal", personalItemId })
 *
 * Body shape:
 *   {
 *     kind: "module" | "personal",
 *     materialId?: string,           // required for "module"
 *     questionIndex?: number,        // required for "module"
 *     personalItemId?: string,       // required for "personal"
 *     rating: "again" | "hard" | "good" | "easy",
 *     // Optional: how the learner reached the rating, recorded in
 *     // question_attempts / user_personal_question_attempts for stats.
 *     selectedChoice?: number,       // 0-3 for MC, 4/5 for free-response binary
 *     isCorrect?: boolean,           // defaults derived from rating
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     next: { ease, intervalDays, reps },
 *     dueAt: string,
 *     intervalMs: number,
 *   }
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_RATINGS: ReadonlySet<SrsRating> = new Set([
  "again",
  "hard",
  "good",
  "easy",
]);

type RatePayload = {
  kind?: string;
  materialId?: string;
  questionIndex?: number;
  personalItemId?: string;
  rating?: string;
  selectedChoice?: number;
  isCorrect?: boolean;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as RatePayload;
  const rating = b.rating as SrsRating | undefined;
  if (!rating || !VALID_RATINGS.has(rating)) {
    return NextResponse.json(
      { error: "rating must be one of: again, hard, good, easy" },
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

  // "isCorrect" defaults: anything other than Again counts as a pass for the
  // legacy `question_attempts.is_correct` boolean (used by the existing
  // "missed" queue and the static review panel).
  const derivedCorrect = rating !== "again";
  const isCorrect = typeof b.isCorrect === "boolean" ? b.isCorrect : derivedCorrect;

  const now = new Date();

  if (b.kind === "module") {
    return rateModuleCard(supabase, user.id, b, rating, isCorrect, now);
  }
  if (b.kind === "personal") {
    return ratePersonalCard(supabase, user.id, b, rating, isCorrect, now);
  }
  return NextResponse.json(
    { error: "kind must be 'module' or 'personal'" },
    { status: 400 }
  );
}

// ---------- Module-bank card -----------------------------------------------

async function rateModuleCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  b: RatePayload,
  rating: SrsRating,
  isCorrect: boolean,
  now: Date
) {
  if (typeof b.materialId !== "string" || !UUID_RE.test(b.materialId)) {
    return NextResponse.json(
      { error: "materialId is required for kind=module" },
      { status: 400 }
    );
  }
  if (typeof b.questionIndex !== "number" || !Number.isFinite(b.questionIndex)) {
    return NextResponse.json(
      { error: "questionIndex is required for kind=module" },
      { status: 400 }
    );
  }

  const { data: matRow } = await supabase
    .from("study_materials")
    .select("id")
    .eq("id", b.materialId)
    .maybeSingle();
  if (!matRow) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  // Load current SRS state (may be absent for a brand-new card).
  const { data: existing } = await supabase
    .from("user_module_card_srs")
    .select(
      "id, srs_ease, srs_interval_days, srs_reps, review_history"
    )
    .eq("user_id", userId)
    .eq("material_id", b.materialId)
    .eq("question_index", b.questionIndex)
    .maybeSingle();

  const prev: SrsCardState = existing
    ? {
        ease: Number(existing.srs_ease) || SRS_DEFAULT_STATE.ease,
        intervalDays:
          Number(existing.srs_interval_days) || SRS_DEFAULT_STATE.intervalDays,
        reps: Number(existing.srs_reps) || SRS_DEFAULT_STATE.reps,
      }
    : { ...SRS_DEFAULT_STATE };

  const { next, dueAt, intervalMs } = applyRating(prev, rating, now);

  const history = appendHistory(existing?.review_history, rating, now);

  const upsertRow = {
    user_id: userId,
    material_id: b.materialId,
    question_index: b.questionIndex,
    srs_ease: next.ease,
    srs_interval_days: next.intervalDays,
    srs_reps: next.reps,
    due_at: dueAt.toISOString(),
    last_reviewed_at: now.toISOString(),
    review_history: history,
    updated_at: now.toISOString(),
  };

  // Insert or update — composite uniqueness handles either path.
  const { error: upsertErr } = await supabase
    .from("user_module_card_srs")
    .upsert(upsertRow, { onConflict: "user_id,material_id,question_index" });

  if (upsertErr) {
    console.error("[srs/rate module upsert]", upsertErr);
    return NextResponse.json(
      { error: "Could not save SRS state." },
      { status: 500 }
    );
  }

  // Also log into question_attempts so the existing "missed queue" + static
  // review panel keep working untouched.
  const selectedChoice =
    typeof b.selectedChoice === "number" ? b.selectedChoice : isCorrect ? 5 : 4;
  const { error: attemptErr } = await supabase.from("question_attempts").insert({
    user_id: userId,
    material_id: b.materialId,
    question_index: b.questionIndex,
    selected_choice: selectedChoice,
    is_correct: isCorrect,
  });
  if (attemptErr) {
    // Non-fatal — SRS state is what the review session depends on.
    console.error("[srs/rate module attempt-log]", attemptErr);
  }

  return NextResponse.json({
    ok: true,
    next,
    dueAt: dueAt.toISOString(),
    intervalMs,
  });
}

// ---------- Personal card --------------------------------------------------

async function ratePersonalCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  b: RatePayload,
  rating: SrsRating,
  isCorrect: boolean,
  now: Date
) {
  if (
    typeof b.personalItemId !== "string" ||
    !UUID_RE.test(b.personalItemId)
  ) {
    return NextResponse.json(
      { error: "personalItemId is required for kind=personal" },
      { status: 400 }
    );
  }

  const { data: card } = await supabase
    .from("user_personal_quiz_items")
    .select("id, srs_ease, srs_interval_days, srs_reps, review_history")
    .eq("id", b.personalItemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const prev: SrsCardState = {
    ease: Number(card.srs_ease) || SRS_DEFAULT_STATE.ease,
    intervalDays:
      Number(card.srs_interval_days) || SRS_DEFAULT_STATE.intervalDays,
    reps: Number(card.srs_reps) || SRS_DEFAULT_STATE.reps,
  };

  const { next, dueAt, intervalMs } = applyRating(prev, rating, now);
  const history = appendHistory(card.review_history, rating, now);

  const { error: updateErr } = await supabase
    .from("user_personal_quiz_items")
    .update({
      srs_ease: next.ease,
      srs_interval_days: next.intervalDays,
      srs_reps: next.reps,
      due_at: dueAt.toISOString(),
      last_reviewed_at: now.toISOString(),
      review_history: history,
    })
    .eq("id", b.personalItemId)
    .eq("user_id", userId);

  if (updateErr) {
    console.error("[srs/rate personal update]", updateErr);
    return NextResponse.json(
      { error: "Could not save SRS state." },
      { status: 500 }
    );
  }

  const selectedChoice =
    typeof b.selectedChoice === "number" ? b.selectedChoice : isCorrect ? 5 : 4;
  const { error: attemptErr } = await supabase
    .from("user_personal_question_attempts")
    .insert({
      user_id: userId,
      personal_item_id: b.personalItemId,
      selected_choice: selectedChoice,
      is_correct: isCorrect,
    });
  if (attemptErr) {
    console.error("[srs/rate personal attempt-log]", attemptErr);
  }

  return NextResponse.json({
    ok: true,
    next,
    dueAt: dueAt.toISOString(),
    intervalMs,
  });
}

// ---------- Helpers --------------------------------------------------------

type HistoryEntry = { at: string; rating: SrsRating };

function appendHistory(
  existing: unknown,
  rating: SrsRating,
  now: Date
): HistoryEntry[] {
  const prior = Array.isArray(existing) ? (existing as HistoryEntry[]) : [];
  // Keep the log bounded so the JSONB column doesn't grow unbounded.
  const trimmed = prior.slice(-199);
  trimmed.push({ at: now.toISOString(), rating });
  return trimmed;
}
