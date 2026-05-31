import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import {
  looksLikeJwtExpired,
  looksLikeMissingProfilesOnboardingMigration,
  looksLikeRowLevelSecurityError,
  looksLikeUsernameConstraintError,
  upsertProfileWithOptionalColumnFallback,
} from "@/lib/profile-upsert-retry";
import {
  ageFromYmd,
  parseUsername,
  personaToStudyFocus,
  type OnboardingGoal,
  type OnboardingPersona,
  type OnboardingReferral,
} from "@/lib/onboarding";

const GOAL_SET = new Set<OnboardingGoal>([
  "exam_prep",
  "understand",
  "ahead",
  "skill",
  "create_share",
  "explore",
]);

const PERSONA_SET = new Set<OnboardingPersona>([
  "student",
  "educator",
  "professional",
  "self_learner",
]);

const REFERRAL_SET = new Set<OnboardingReferral>([
  "friend",
  "social",
  "google",
  "teacher",
  "other",
]);

const SCHOOL_MAX = 200;

function parseYmd(raw: unknown): { y: number; m: number; d: number } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
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

  const b = body as Record<string, unknown>;

  const persona = b.persona;
  if (typeof persona !== "string" || !PERSONA_SET.has(persona as OnboardingPersona)) {
    return NextResponse.json({ error: "Invalid persona." }, { status: 400 });
  }
  const p = persona as OnboardingPersona;

  const goalsRaw = b.studyGoals;
  if (!Array.isArray(goalsRaw) || goalsRaw.length === 0) {
    return NextResponse.json(
      { error: "Select at least one goal." },
      { status: 400 }
    );
  }
  const studyGoals: OnboardingGoal[] = [];
  for (const g of goalsRaw) {
    if (typeof g !== "string" || !GOAL_SET.has(g as OnboardingGoal)) {
      return NextResponse.json({ error: "Invalid study goal." }, { status: 400 });
    }
    studyGoals.push(g as OnboardingGoal);
  }

  let schoolName: string | null = null;
  if (Object.prototype.hasOwnProperty.call(b, "schoolName")) {
    const sn = b.schoolName;
    if (sn !== null && typeof sn !== "string") {
      return NextResponse.json({ error: "Invalid school name." }, { status: 400 });
    }
    if (typeof sn === "string") {
      const t = sn.trim();
      schoolName = t.length === 0 ? null : t.slice(0, SCHOOL_MAX);
    }
  }

  const usernameParsed = parseUsername(
    typeof b.username === "string" ? b.username : ""
  );
  if (!usernameParsed) {
    return NextResponse.json(
      { error: "Username must be 3–30 letters, numbers, or underscores." },
      { status: 400 }
    );
  }

  const ymd = parseYmd(b.birthday);
  if (!ymd) {
    return NextResponse.json({ error: "Invalid birthday." }, { status: 400 });
  }
  const age = ageFromYmd(ymd.y, ymd.m, ymd.d);
  if (Number.isNaN(age) || age < 13) {
    return NextResponse.json({ error: "You must be 13 or older." }, { status: 400 });
  }

  const ref = b.referralSource;
  if (typeof ref !== "string" || !REFERRAL_SET.has(ref as OnboardingReferral)) {
    return NextResponse.json({ error: "Invalid referral source." }, { status: 400 });
  }
  const referralSource = ref as OnboardingReferral;

  const { data: avail, error: availErr } = await supabase.rpc(
    "profile_username_available",
    { p_username: usernameParsed }
  );
  if (availErr) {
    console.error(availErr);
    return NextResponse.json(
      { error: "Could not verify username. Try again." },
      { status: 503 }
    );
  }
  if (!avail) {
    return NextResponse.json({ error: "Username is taken." }, { status: 409 });
  }

  const birthday = `${String(ymd.y).padStart(4, "0")}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`;
  const studyFocus = personaToStudyFocus(p);
  const completedAt = new Date().toISOString();

  const row = {
    id: user.id,
    username: usernameParsed,
    school_name: schoolName,
    study_goals: studyGoals,
    referral_source: referralSource,
    onboarding_persona: p,
    study_focus: studyFocus,
    birthday,
    onboarding_completed_at: completedAt,
  };

  const upResult = await upsertProfileWithOptionalColumnFallback(
    async (r) => {
      const { error } = await supabase.from("profiles").upsert(r as never, {
        onConflict: "id",
      });
      return { error };
    },
    row
  );

  if (!upResult.ok) {
    const upErr = upResult.error;
    if (looksLikeUsernameConstraintError(upErr.message)) {
      return NextResponse.json({ error: "Username is taken." }, { status: 409 });
    }
    if (looksLikeJwtExpired(upErr.message)) {
      return NextResponse.json(
        {
          error: "Your session expired. Please sign in again and try Finish once more.",
          code: "jwt_expired",
        },
        { status: 401 }
      );
    }
    if (looksLikeRowLevelSecurityError(upErr.message)) {
      return NextResponse.json(
        {
          error:
            "Could not save your profile (access was denied). Try signing out, signing back in, then tap Finish again.",
          code: upErr.code ?? "42501",
        },
        { status: 403 }
      );
    }
    if (looksLikeMissingProfilesOnboardingMigration(upErr.message)) {
      return NextResponse.json(
        {
          error:
            "Your Supabase database is missing profile columns used by onboarding. In the Supabase dashboard → SQL Editor, run the scripts from `supabase/migrations/015_profiles_study_focus.sql` (study_focus) and `supabase/migrations/026_onboarding_profile_fields.sql` (including `profile_username_available`), reload the project if needed, then try Finish again.",
          code: "schema_migration",
        },
        { status: 503 }
      );
    }
    console.error("[onboarding/complete]", upErr);
    const devHint =
      process.env.NODE_ENV === "development"
        ? ` (${upErr.code ?? ""} ${upErr.message ?? ""})`
        : "";
    return NextResponse.json(
      {
        error: `Could not save onboarding. Please try again.${devHint}`,
        code: upErr.code ?? "upsert_failed",
      },
      { status: 500 }
    );
  }

  await logActivity({
    userId: user.id,
    type: "onboarding_completed",
    summary: usernameParsed,
    metadata: { persona: p },
  });

  return NextResponse.json({ ok: true });
}
