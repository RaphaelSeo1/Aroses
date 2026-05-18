import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type {
  GoalsAnswer,
  KnowledgeLevel,
  LevelQuizState,
  MentoredOnboardingPatch,
  MentoredOnboardingRecord,
  MentoredPersonalization,
} from "@/types/mentored";

/**
 * GET  /api/mentored/onboarding/[materialId]
 *   Returns the onboarding row (or null if not started).
 *
 * POST /api/mentored/onboarding/[materialId]
 *   Upsert partial onboarding state. Body is `MentoredOnboardingPatch`.
 *   Send `{ completedAt: new Date().toISOString() }` to mark onboarding done.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

function defaultLevelQuiz(): LevelQuizState {
  return { questions: [], answers: [], scorePct: 0 };
}

function normalize(row: {
  id: string;
  user_id: string;
  material_id: string;
  goals: unknown;
  knowledge_level: string;
  level_quiz: unknown;
  path_choice: string;
  interaction_mode: string;
  personalization?: unknown;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}): MentoredOnboardingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    materialId: row.material_id,
    goals: Array.isArray(row.goals) ? (row.goals as GoalsAnswer[]) : [],
    knowledgeLevel: (row.knowledge_level as KnowledgeLevel) ?? "beginner",
    levelQuiz:
      row.level_quiz && typeof row.level_quiz === "object"
        ? (row.level_quiz as LevelQuizState)
        : defaultLevelQuiz(),
    pathChoice: row.path_choice === "personalized" ? "personalized" : "original",
    interactionMode: row.interaction_mode === "text" ? "text" : "voice",
    personalization:
      row.personalization && typeof row.personalization === "object"
        ? (row.personalization as MentoredPersonalization)
        : {},
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  "id, user_id, material_id, goals, knowledge_level, level_quiz, path_choice, interaction_mode, personalization, completed_at, created_at, updated_at";

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
    .from("user_course_onboarding")
    .select(SELECT_COLS)
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    console.error("[mentored/onboarding GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }

  return NextResponse.json({
    onboarding: data ? normalize(data as Parameters<typeof normalize>[0]) : null,
  });
}

export async function POST(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  let body: MentoredOnboardingPatch;
  try {
    body = (await request.json()) as MentoredOnboardingPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    user_id: user.id,
    material_id: materialId,
    updated_at: now,
  };

  if (Array.isArray(body.goals)) update.goals = body.goals;
  if (
    body.knowledgeLevel === "beginner" ||
    body.knowledgeLevel === "intermediate" ||
    body.knowledgeLevel === "advanced"
  ) {
    update.knowledge_level = body.knowledgeLevel;
  }
  if (body.levelQuiz && typeof body.levelQuiz === "object") {
    update.level_quiz = body.levelQuiz;
  }
  if (body.pathChoice === "personalized" || body.pathChoice === "original") {
    update.path_choice = body.pathChoice;
  }
  if (body.interactionMode === "voice" || body.interactionMode === "text") {
    update.interaction_mode = body.interactionMode;
  }
  if (body.personalization && typeof body.personalization === "object") {
    // Trust the shape from the client only after a soft validation —
    // we don't want a free-form string field to leak in here.
    const p = body.personalization;
    const safe: MentoredPersonalization = {};
    if (Array.isArray(p.knownTopics)) {
      safe.knownTopics = p.knownTopics
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 12);
    }
    if (Array.isArray(p.focusAreas)) {
      safe.focusAreas = p.focusAreas
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 12);
    }
    if (
      p.experienceLevel === "beginner" ||
      p.experienceLevel === "intermediate" ||
      p.experienceLevel === "advanced"
    ) {
      safe.experienceLevel = p.experienceLevel;
    }
    if (typeof p.summary === "string") {
      safe.summary = p.summary.trim().slice(0, 320);
    }
    update.personalization = safe;
  }
  if (body.completedAt !== undefined) {
    update.completed_at = body.completedAt;
  }

  const { data, error } = await supabase
    .from("user_course_onboarding")
    .upsert(update, { onConflict: "user_id,material_id" })
    .select(SELECT_COLS)
    .maybeSingle();

  if (error || !data) {
    console.error("[mentored/onboarding POST]", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({
    onboarding: normalize(data as Parameters<typeof normalize>[0]),
  });
}
