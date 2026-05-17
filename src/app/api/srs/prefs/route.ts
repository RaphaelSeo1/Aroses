import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  /api/srs/prefs — fetch the user's SRS preferences (or defaults).
 * PUT  /api/srs/prefs — partial update (any subset of the editable fields).
 */

export type SrsPrefs = {
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  defaultDashboardSelection: "all" | "last" | "none";
  showCourseBadge: boolean;
  dailyReviewGoal: number;
};

const DEFAULTS: SrsPrefs = {
  newCardsPerDay: 20,
  maxReviewsPerDay: 100,
  defaultDashboardSelection: "all",
  showCourseBadge: true,
  dailyReviewGoal: 30,
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(DEFAULTS);
  }
  const { data } = await supabase
    .from("user_srs_prefs")
    .select(
      "new_cards_per_day, max_reviews_per_day, default_dashboard_selection, show_course_badge, daily_review_goal"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return NextResponse.json(DEFAULTS);

  return NextResponse.json({
    newCardsPerDay: Number(data.new_cards_per_day) || DEFAULTS.newCardsPerDay,
    maxReviewsPerDay:
      Number(data.max_reviews_per_day) || DEFAULTS.maxReviewsPerDay,
    defaultDashboardSelection:
      (data.default_dashboard_selection as SrsPrefs["defaultDashboardSelection"]) ??
      DEFAULTS.defaultDashboardSelection,
    showCourseBadge:
      typeof data.show_course_badge === "boolean"
        ? data.show_course_badge
        : DEFAULTS.showCourseBadge,
    dailyReviewGoal:
      Number(data.daily_review_goal) || DEFAULTS.dailyReviewGoal,
  });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Partial<SrsPrefs>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.newCardsPerDay === "number") {
    patch.new_cards_per_day = clamp(body.newCardsPerDay, 0, 500);
  }
  if (typeof body.maxReviewsPerDay === "number") {
    patch.max_reviews_per_day = clamp(body.maxReviewsPerDay, 0, 2000);
  }
  if (
    body.defaultDashboardSelection === "all" ||
    body.defaultDashboardSelection === "last" ||
    body.defaultDashboardSelection === "none"
  ) {
    patch.default_dashboard_selection = body.defaultDashboardSelection;
  }
  if (typeof body.showCourseBadge === "boolean") {
    patch.show_course_badge = body.showCourseBadge;
  }
  if (typeof body.dailyReviewGoal === "number") {
    patch.daily_review_goal = clamp(body.dailyReviewGoal, 0, 1000);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }
  patch.user_id = user.id;
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("user_srs_prefs")
    .upsert(patch, { onConflict: "user_id" });

  if (error) {
    console.error("[srs prefs upsert]", error);
    return NextResponse.json(
      { error: "Could not save preferences." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}
