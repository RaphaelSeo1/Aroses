/**
 * Central place for tier limits, quotas, and feature flags for the voice tutor.
 * Phase 1: always allow — wire billing / plan checks here later.
 */
export type VoiceTutorGate =
  | { allowed: true }
  | { allowed: false; reason: string };

export async function getVoiceTutorGate(opts: {
  userId: string;
  materialId: string;
  courseId?: string;
}): Promise<VoiceTutorGate> {
  void opts;
  return { allowed: true };
}
