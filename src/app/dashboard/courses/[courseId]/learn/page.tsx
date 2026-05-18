import { notFound, redirect } from "next/navigation";
import { ImmersiveLearnClient } from "@/components/immersive/ImmersiveLearnClient";
import { resolveResumeTarget } from "@/lib/study/resolve-resume-target";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";
import type {
  CourseMode,
  GoalsAnswer,
  KnowledgeLevel,
  LevelQuizState,
  MentoredOnboardingRecord,
  MentoredPersonalization,
} from "@/types/mentored";

/**
 * Immersive Mentored Learning entry route.
 *
 * Mirrors the resolution logic from /study (resume target, material picker)
 * but renders the cloud + glass-morphism shell instead of the course player.
 * The student is greeted, picks a mode, and either lands on the immersive
 * lesson runner or gets routed to /study for Free Exploration.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ material?: string; module?: string }>;
};

export default async function LearnPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const { material: materialParam, module: moduleParam } = await searchParams;

  if (!UUID_RE.test(courseId)) notFound();

  const moduleNumFromUrl =
    typeof moduleParam === "string" ? Number(moduleParam) : Number.NaN;
  const moduleIdFromUrl = Number.isFinite(moduleNumFromUrl)
    ? moduleNumFromUrl
    : undefined;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/learn`)}`
    );
  }

  const courseRow = await fetchCourseForDashboard(supabase, courseId, user.id);
  if (!courseRow) notFound();

  // ---- resolve which material to open ----
  let materialId: string | null = null;
  let moduleIdToOpen: number | null = null;

  if (typeof materialParam === "string" && UUID_RE.test(materialParam)) {
    materialId = materialParam;
    moduleIdToOpen = moduleIdFromUrl ?? null;
  } else {
    const target = await resolveResumeTarget(supabase, courseRow.id, user.id);
    if (target) {
      materialId = target.materialId;
      moduleIdToOpen = target.moduleId;
    }
  }

  if (!materialId) {
    redirect(`/dashboard/courses/${courseId}`);
  }

  // ---- load course payload ----
  const { data: matRow, error: matErr } = await supabase
    .from("study_materials")
    .select("id, course_id, course_payload")
    .eq("id", materialId)
    .eq("course_id", courseRow.id)
    .maybeSingle();

  if (matErr) {
    console.error("[learn page] material load", matErr);
    redirect(`/dashboard/courses/${courseId}`);
  }
  if (!matRow) notFound();

  const payload = matRow.course_payload as CoursePayload | null | undefined;
  const hasModules =
    payload &&
    typeof payload.title === "string" &&
    Array.isArray(payload.modules) &&
    payload.modules.length > 0;

  if (!hasModules || !payload) {
    // No generated course yet — drop them back to the course detail page so
    // they can see the "build status" view instead of an empty immersive
    // shell with nothing to teach.
    redirect(`/dashboard/courses/${courseId}`);
  }

  const initialModuleId =
    (typeof moduleIdToOpen === "number" &&
      payload.modules.some((m) => m.id === moduleIdToOpen) &&
      moduleIdToOpen) ||
    payload.modules[0].id;

  // ---- onboarding state ----
  const { data: onboardingRow } = await supabase
    .from("user_course_onboarding")
    .select(
      "id, user_id, material_id, goals, knowledge_level, level_quiz, path_choice, interaction_mode, personalization, completed_at, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  const initialOnboarding: MentoredOnboardingRecord | null = onboardingRow
    ? {
        id: onboardingRow.id as string,
        userId: onboardingRow.user_id as string,
        materialId: onboardingRow.material_id as string,
        goals: Array.isArray(onboardingRow.goals)
          ? (onboardingRow.goals as GoalsAnswer[])
          : [],
        knowledgeLevel:
          (onboardingRow.knowledge_level as KnowledgeLevel) ?? "beginner",
        levelQuiz:
          onboardingRow.level_quiz &&
          typeof onboardingRow.level_quiz === "object"
            ? (onboardingRow.level_quiz as LevelQuizState)
            : { questions: [], answers: [], scorePct: 0 },
        pathChoice:
          onboardingRow.path_choice === "personalized"
            ? "personalized"
            : "original",
        interactionMode:
          onboardingRow.interaction_mode === "text" ? "text" : "voice",
        personalization:
          onboardingRow.personalization &&
          typeof onboardingRow.personalization === "object"
            ? (onboardingRow.personalization as MentoredPersonalization)
            : {},
        completedAt: (onboardingRow.completed_at as string | null) ?? null,
        createdAt: onboardingRow.created_at as string,
        updatedAt: onboardingRow.updated_at as string,
      }
    : null;

  // ---- previous mode pref (just to bias the picker visually) ----
  const { data: modePrefRow } = await supabase
    .from("user_course_mode_prefs")
    .select("mode")
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  const initialMode: CourseMode | null =
    modePrefRow && (modePrefRow.mode === "free" || modePrefRow.mode === "mentored")
      ? (modePrefRow.mode as CourseMode)
      : null;

  return (
    <ImmersiveLearnClient
      courseId={courseId}
      materialId={materialId}
      course={payload}
      initialModuleId={initialModuleId}
      initialOnboarding={initialOnboarding}
      initialMode={initialMode}
    />
  );
}
