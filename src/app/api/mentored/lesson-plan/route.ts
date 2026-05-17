import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { generateLessonPlan } from "@/lib/ai/mentored";
import type { CoursePayload } from "@/types/course";
import type {
  GoalsAnswer,
  KnowledgeLevel,
  MentoredLessonPlan,
} from "@/types/mentored";

/**
 * POST /api/mentored/lesson-plan
 *
 * Body: { materialId, moduleId, forceRegenerate? }
 *
 * Returns the cached lesson plan for this module from
 * user_mentored_sessions.lesson_plan if it exists and is for the same
 * moduleId; otherwise generates a fresh plan via Claude and writes it
 * back to the session row.
 *
 * The user's `knowledge_level` and `goals` from user_course_onboarding
 * are threaded into the prompt so depth/analogies are calibrated.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  materialId?: string;
  moduleId?: number;
  forceRegenerate?: boolean;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }
  if (
    typeof body.moduleId !== "number" ||
    !Number.isFinite(body.moduleId) ||
    body.moduleId < 1
  ) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, body.materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const moduleId = body.moduleId;

  // Check for a cached plan first. We intentionally accept ANY non-empty
  // cached plan regardless of generator version — older v1 plans simply
  // won't have `keyTerms`, which the SourceLessonPanel handles gracefully
  // by skipping the glow. Forcing a regeneration on every prompt bump
  // makes the first entry feel slow (Claude regen takes 10-20s), which
  // isn't worth it for a non-critical visual feature.
  if (!body.forceRegenerate) {
    const { data: existing } = await supabase
      .from("user_mentored_sessions")
      .select("lesson_plan")
      .eq("user_id", user.id)
      .eq("material_id", body.materialId)
      .maybeSingle();
    const cached = existing?.lesson_plan as MentoredLessonPlan | null;
    if (cached && cached.moduleId === moduleId && cached.chunks.length > 0) {
      return NextResponse.json({ plan: cached, cached: true });
    }
  }

  // Pull course payload + onboarding context.
  const [{ data: mat }, { data: onboarding }] = await Promise.all([
    supabase
      .from("study_materials")
      .select("course_payload")
      .eq("id", body.materialId)
      .maybeSingle(),
    supabase
      .from("user_course_onboarding")
      .select("goals, knowledge_level")
      .eq("user_id", user.id)
      .eq("material_id", body.materialId)
      .maybeSingle(),
  ]);

  const payload = mat?.course_payload as CoursePayload | null;
  if (!payload) {
    return NextResponse.json(
      { error: "Course not ready." },
      { status: 409 }
    );
  }

  const module = payload.modules.find((m) => m.id === moduleId);
  if (!module) {
    return NextResponse.json({ error: "Module not found." }, { status: 404 });
  }

  const goals = (Array.isArray(onboarding?.goals)
    ? (onboarding!.goals as unknown[])
    : []) as GoalsAnswer[];
  const knowledgeLevel: KnowledgeLevel =
    onboarding?.knowledge_level === "advanced"
      ? "advanced"
      : onboarding?.knowledge_level === "intermediate"
        ? "intermediate"
        : "beginner";

  try {
    const plan = await generateLessonPlan({
      module,
      goals,
      knowledgeLevel,
    });
    // Cache on the session row so subsequent loads of this module are free.
    await supabase.from("user_mentored_sessions").upsert(
      {
        user_id: user.id,
        material_id: body.materialId,
        module_id: moduleId,
        lesson_plan: plan,
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,material_id" }
    );
    return NextResponse.json({ plan, cached: false });
  } catch (e) {
    console.error("[mentored/lesson-plan]", e);
    return NextResponse.json(
      { error: "Could not build lesson plan. Try again shortly." },
      { status: 502 }
    );
  }
}
