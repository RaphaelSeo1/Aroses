import { notFound, redirect } from "next/navigation";
import { ImmersiveLearnClient } from "@/components/immersive/ImmersiveLearnClient";
import {
  loadCourseProgress,
  upsertCourseProgress,
} from "@/lib/course-progress/db";
import { resolveMentoredModuleForMaterial } from "@/lib/study/resolve-mentored-module";
import { resolveResumeTarget } from "@/lib/study/resolve-resume-target";
import { fetchStudyMaterialForPublicExplore } from "@/lib/supabase/fetch-explore-study-material";
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
 * Immersive Mentored Learning entry — Explore (public) side.
 *
 * Twin of `/dashboard/courses/[courseId]/learn` but resolves the course
 * via the public-explore path (`is_public = true` + `fetchStudyMaterialForPublicExplore`)
 * so any signed-in learner can launch the AI tutor for a community course,
 * not just the owner.
 *
 * Per-user mentored state (onboarding, mode pref, session) is still keyed
 * on (user_id, material_id) the same way as the dashboard route, so a
 * learner exploring a public course gets their own tutor history.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ material?: string; module?: string }>;
};

export default async function ExploreLearnPage({
  params,
  searchParams,
}: Props) {
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
      `/login?next=${encodeURIComponent(`/explore/${courseId}/learn`)}`
    );
  }

  // The explore listing only surfaces public courses — mirror that here so
  // an authed user can't side-load a private course via this URL.
  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, title, description")
    .eq("id", courseId)
    .eq("is_public", true)
    .maybeSingle();

  if (!courseRow) notFound();

  const savedProgress = await loadCourseProgress(
    supabase,
    user.id,
    courseRow.id
  );

  // ---- resolve which material to open ----
  let materialId: string | null = null;
  let moduleIdToOpen: number | null = null;

  if (typeof materialParam === "string" && UUID_RE.test(materialParam)) {
    materialId = materialParam;
    moduleIdToOpen = moduleIdFromUrl ?? null;
    if (moduleIdToOpen == null) {
      moduleIdToOpen = await resolveMentoredModuleForMaterial(
        supabase,
        user.id,
        materialId
      );
    }
  } else {
    const target = await resolveResumeTarget(supabase, courseRow.id, user.id);
    if (target) {
      if (target.mode === "free") {
        const qs = new URLSearchParams();
        qs.set("material", target.materialId);
        if (target.moduleId != null) qs.set("module", String(target.moduleId));
        if (target.lessonIndex != null) qs.set("lesson", String(target.lessonIndex));
        if (target.scrollPosition != null && target.scrollPosition > 0) {
          qs.set("scroll", String(target.scrollPosition));
        }
        qs.set("mode", "learn");
        redirect(`/explore/${courseId}/study?${qs.toString()}`);
      }
      materialId = target.materialId;
      moduleIdToOpen = target.moduleId;
    }
  }

  // Fall back to the canonical "first material" for this public course if
  // the user has zero history yet. Uses the same admin-fallback strategy
  // as /explore/[id]/study so RLS for anon learners doesn't bite.
  if (!materialId) {
    const { row: firstRow } = await fetchStudyMaterialForPublicExplore(
      supabase,
      courseRow.id
    );
    if (firstRow) {
      materialId = firstRow.id;
    }
  }

  if (!materialId) {
    redirect(`/explore/${courseId}`);
  }

  // ---- load course payload ----
  const { row: matRow, error: matErr } =
    await fetchStudyMaterialForPublicExplore(
      supabase,
      courseRow.id,
      materialId
    );

  if (matErr) {
    console.error("[explore learn] material load", matErr);
    redirect(`/explore/${courseId}`);
  }
  if (!matRow) notFound();

  const payload = matRow.course_payload as CoursePayload | null | undefined;
  const hasModules =
    payload &&
    typeof payload.title === "string" &&
    Array.isArray(payload.modules) &&
    payload.modules.length > 0;

  if (!hasModules || !payload) {
    // No generated content for this material yet — bounce to the listing
    // so the learner can see the "still building" state instead of an
    // empty immersive shell.
    redirect(`/explore/${courseId}`);
  }

  const initialModuleId =
    (typeof moduleIdToOpen === "number" &&
      payload.modules.some((m) => m.id === moduleIdToOpen) &&
      moduleIdToOpen) ||
    payload.modules[0].id;

  const progressSaysFree = savedProgress?.lastMode === "free";

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

  // ---- previous mode pref ----
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

  const explicitMentoredSwitch =
    typeof moduleParam === "string" &&
    moduleParam.trim().length > 0 &&
    Number.isFinite(Number(moduleParam));

  if ((initialMode === "free" || progressSaysFree) && !explicitMentoredSwitch) {
    const qs = new URLSearchParams();
    const resumeMaterial =
      progressSaysFree && savedProgress?.materialId
        ? savedProgress.materialId
        : materialId;
    const resumeModule =
      progressSaysFree && savedProgress?.lastModuleId != null
        ? savedProgress.lastModuleId
        : initialModuleId;
    qs.set("material", resumeMaterial);
    qs.set("module", String(resumeModule));
    qs.set("mode", "learn");
    if (progressSaysFree && savedProgress) {
      if (savedProgress.lastLessonIndex > 0) {
        qs.set("lesson", String(savedProgress.lastLessonIndex));
      }
      if (
        savedProgress.lastScrollPosition != null &&
        savedProgress.lastScrollPosition > 0
      ) {
        qs.set("scroll", String(savedProgress.lastScrollPosition));
      }
    }
    redirect(`/explore/${courseId}/study?${qs.toString()}`);
  }

  await upsertCourseProgress(supabase, user.id, courseRow.id, {
    materialId,
    lastModuleId: initialModuleId,
    lastMode: "mentored",
  });

  return (
    <ImmersiveLearnClient
      courseId={courseId}
      materialId={materialId}
      course={payload}
      initialModuleId={initialModuleId}
      initialOnboarding={initialOnboarding}
      initialMode={initialMode}
      surface="explore"
    />
  );
}
