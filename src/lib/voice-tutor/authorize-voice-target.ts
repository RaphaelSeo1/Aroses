import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadStudyMaterial } from "@/lib/voice-tutor/material-access";
import { getVoiceTutorGate } from "@/lib/voice-tutor/policy";
import { isUuid } from "@/lib/voice-tutor/uuid";

export type VoiceTargetAuth =
  | { ok: true; courseId?: string }
  | { ok: false; status: number; error: string };

/**
 * Shared access check for /api/voice-tutor/{tts,transcribe}.
 *
 * Accepts exactly one of:
 *   - tutor session id
 *   - live lecture session id (Ask Rose during a lecture)
 *   - study material id (course / free-exploration chat)
 */
export async function authorizeVoiceTutorTarget(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    sessionId?: unknown;
    materialId?: unknown;
    courseId?: unknown;
  }
): Promise<VoiceTargetAuth> {
  const sessionId =
    typeof opts.sessionId === "string" && isUuid(opts.sessionId)
      ? opts.sessionId
      : "";
  const materialId =
    typeof opts.materialId === "string" && isUuid(opts.materialId)
      ? opts.materialId
      : "";
  const courseId =
    typeof opts.courseId === "string" && isUuid(opts.courseId)
      ? opts.courseId
      : undefined;

  if (sessionId) {
    const { data: tutorRow } = await supabase
      .from("tutor_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (tutorRow && tutorRow.user_id === userId) {
      return { ok: true, courseId: undefined };
    }

    const { data: liveRow } = await supabase
      .from("live_lecture_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (liveRow && liveRow.user_id === userId) {
      return { ok: true, courseId: undefined };
    }

    return { ok: false, status: 404, error: "Session not found" };
  }

  if (materialId) {
    const readable = await canReadStudyMaterial(supabase, materialId);
    if (!readable) {
      return { ok: false, status: 404, error: "Material not found" };
    }
    const gate = await getVoiceTutorGate({
      userId,
      materialId,
      courseId,
    });
    if (!gate.allowed) {
      return { ok: false, status: 403, error: gate.reason };
    }
    return { ok: true, courseId };
  }

  return { ok: false, status: 400, error: "Missing materialId or sessionId" };
}
