import { LessonPlanLoading } from "@/components/immersive/LessonPlanLoading";

/**
 * Renders instantly when the student clicks "Start learning" so the
 * cloud + glass shell appears immediately — no flash of the previous
 * page while the server resolves session / onboarding / lesson data.
 *
 * This Suspense fallback gets swapped out once `page.tsx` is done
 * rendering. The page itself takes over the same shell so the
 * transition is seamless.
 */
export default function LearnLoading() {
  return <LessonPlanLoading stage="session" />;
}
