import "server-only";
import { assertCanCreateCourse } from "@/lib/billing/course-cap";
import { assertCanStartLectureRecording } from "@/lib/billing/lecture-recording-cap";
import {
  courseCap,
  lectureRecordingCap,
  voiceCapSeconds,
} from "@/lib/billing/plans";
import type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";
import { getUserSubscription } from "@/lib/billing/subscription";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";

export type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";

/**
 * Snapshot of metered plan usage for the current billing period.
 * Caps always come from `PLANS`; used counts come from the same gates as
 * create-course / start-recording / voice allowance.
 */
export async function getPlanUsageSummary(
  userId: string,
  opts?: { email?: string | null }
): Promise<PlanUsageSummary> {
  const [sub, courseGate, lectureGate, voice] = await Promise.all([
    getUserSubscription(userId),
    assertCanCreateCourse(userId),
    assertCanStartLectureRecording(userId),
    checkVoiceAllowance(userId, opts),
  ]);

  const tier = sub.tier;
  const coursesCap = courseCap(tier);
  const recordingsCap = lectureRecordingCap(tier);
  const voiceCap = voiceCapSeconds(tier);

  // Dev voice allowance returns a fake unlimited free meter — keep the UI
  // honest by showing the real plan cap with zero used locally.
  const voiceUsedSeconds =
    process.env.NODE_ENV === "development"
      ? 0
      : Math.max(0, voice.usedSeconds);

  return {
    tier,
    coursesUsed: Math.max(0, courseGate.used),
    coursesCap,
    voiceUsedSeconds,
    voiceCapSeconds: voiceCap,
    recordingsUsed: Math.max(0, lectureGate.used),
    recordingsCap,
  };
}
