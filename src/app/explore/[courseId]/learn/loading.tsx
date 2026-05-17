import { LessonPlanLoading } from "@/components/immersive/LessonPlanLoading";

/**
 * Renders instantly when a learner clicks "Start learning" from the
 * explore listing, so the cloud + glass shell appears immediately — no
 * flash of the explore page while the server resolves session /
 * onboarding / lesson data.
 */
export default function ExploreLearnLoading() {
  return <LessonPlanLoading stage="session" />;
}
