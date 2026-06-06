import type { SupabaseClient } from "@supabase/supabase-js";
import { extractPersonalization } from "@/lib/ai/mentored";
import { loadStudyContextForMaterial } from "@/lib/load-course-study-context";
import {
  isPersonalizationEmpty,
  mergeMentoredPersonalization,
  selfStudyContextToPersonalization,
} from "@/lib/self-study-context";
import type {
  GoalsAnswer,
  KnowledgeLevel,
  MentoredPersonalization,
} from "@/types/mentored";

function isLevel(v: unknown): v is KnowledgeLevel {
  return v === "beginner" || v === "intermediate" || v === "advanced";
}

/**
 * Onboarding personalization first; fall back to course `study_context`
 * for self-study sessions; optionally lazy-extract from onboarding goals.
 */
export async function loadMentoredPersonalization(
  supabase: SupabaseClient,
  userId: string,
  materialId: string
): Promise<{ personalization: MentoredPersonalization; shouldPersist: boolean }> {
  let personalization: MentoredPersonalization = {};
  let shouldPersist = false;

  const { data: onboardingRow } = await supabase
    .from("user_course_onboarding")
    .select("goals, knowledge_level, personalization")
    .eq("user_id", userId)
    .eq("material_id", materialId)
    .maybeSingle();

  const existing =
    onboardingRow?.personalization &&
    typeof onboardingRow.personalization === "object"
      ? (onboardingRow.personalization as MentoredPersonalization)
      : {};

  if (!isPersonalizationEmpty(existing)) {
    personalization = existing;
  } else if (
    onboardingRow?.goals &&
    Array.isArray(onboardingRow.goals) &&
    onboardingRow.goals.length > 0
  ) {
    try {
      personalization = await extractPersonalization({
        goals: onboardingRow.goals as GoalsAnswer[],
        quizLevel: isLevel(onboardingRow.knowledge_level)
          ? onboardingRow.knowledge_level
          : undefined,
      });
      shouldPersist = true;
    } catch (e) {
      console.error("[loadMentoredPersonalization] extract", e);
    }
  }

  const studyCtx = await loadStudyContextForMaterial(supabase, materialId);
  if (studyCtx) {
    const fromStudy = selfStudyContextToPersonalization(studyCtx);
    if (!isPersonalizationEmpty(fromStudy)) {
      personalization = mergeMentoredPersonalization(
        personalization,
        fromStudy
      );
      if (isPersonalizationEmpty(existing)) {
        shouldPersist = true;
      }
    }
  }

  return { personalization, shouldPersist };
}
