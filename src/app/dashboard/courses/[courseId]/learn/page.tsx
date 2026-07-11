import { notFound, redirect } from "next/navigation";
import { ImmersiveLearnClient } from "@/components/immersive/ImmersiveLearnClient";
import {
  loadCourseProgress,
  upsertCourseProgress,
} from "@/lib/course-progress/db";
import { orderMaterialIds } from "@/lib/study/order-material-ids";
import { resolveMentoredModuleForMaterial } from "@/lib/study/resolve-mentored-module";
import { resolveResumeTarget } from "@/lib/study/resolve-resume-target";
import { loadCourseOutputLanguageForMaterial } from "@/lib/load-course-output-language";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import { parseCoursePayload } from "@/lib/ai/course-payload";
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
    // URL often has `material=` but omits `module=` (e.g. home-page
    // "Open"). Without this we always fell back to module 1 even when
    // the student had a mentored session mid-course.
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
        redirect(`/dashboard/courses/${courseId}/study?${qs.toString()}`);
      }
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
    .select("id, course_id, course_payload, asset_manifest")
    .eq("id", materialId)
    .eq("course_id", courseRow.id)
    .maybeSingle();

  if (matErr) {
    console.error("[learn page] material load", matErr);
    redirect(`/dashboard/courses/${courseId}`);
  }
  if (!matRow) notFound();

  let payload: CoursePayload | null = null;
  try {
    if (matRow.course_payload) {
      payload = parseCoursePayload(matRow.course_payload);
    }
  } catch (e) {
    console.error("[learn page] parse course_payload", e);
  }
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

  const explicitMentoredSwitch =
    typeof moduleParam === "string" &&
    moduleParam.trim().length > 0 &&
    Number.isFinite(Number(moduleParam));

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
        // Separate graceful read: missing column (pre-migration) resolves "".
        noteInstruction: await loadNoteInstruction(
          supabase,
          "user_course_onboarding",
          { user_id: user.id, material_id: materialId }
        ),
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
    modePrefRow?.mode === "free" || modePrefRow?.mode === "mentored"
      ? (modePrefRow.mode as CourseMode)
      : savedProgress?.lastMode === "free" || savedProgress?.lastMode === "mentored"
        ? savedProgress.lastMode
        : null;

  // Students in Free Exploration should land on /study — check both the
  // per-material mode pref and the course-level progress record.
  if ((initialMode === "free" || progressSaysFree) && !explicitMentoredSwitch) {
    console.log("[mode-persist] learn redirect to study", {
      courseId,
      materialId,
      initialMode,
      progressSaysFree,
    });
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
    redirect(`/dashboard/courses/${courseId}/study?${qs.toString()}`);
  }

  await upsertCourseProgress(supabase, user.id, courseRow.id, {
    materialId,
    lastModuleId: initialModuleId,
    lastMode: "mentored",
  });

  // All materials in this course, in learning order (by section, then position),
  // so the runner can roll the student into the next section once they finish
  // the current material.
  const [{ data: courseMaterials }, { data: examGroups }] = await Promise.all([
    supabase
      .from("study_materials")
      .select("id, exam_group_id, sort_order, created_at")
      .eq("course_id", courseRow.id),
    supabase
      .from("exam_groups")
      .select("id, sort_order, created_at")
      .eq("course_id", courseRow.id),
  ]);
  const materialIds = orderMaterialIds(courseMaterials ?? [], examGroups ?? []);

  const outputLanguage = await loadCourseOutputLanguageForMaterial(
    supabase,
    materialId
  );

  return (
    <ImmersiveLearnClient
      courseId={courseId}
      materialId={materialId}
      course={payload}
      initialModuleId={initialModuleId}
      initialOnboarding={initialOnboarding}
      initialMode={initialMode}
      outputLanguage={outputLanguage}
      materialIds={materialIds}
    />
  );
}
