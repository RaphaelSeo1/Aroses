import "server-only";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { getUserSubscription } from "@/lib/billing/subscription";
import { voiceCapSeconds, type PlanTier } from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { report } from "@/lib/report-error";

/**
 * Voice usage metering + cap enforcement.
 *
 * Voice is the metered premium. TTS synthesis records spoken seconds (estimated
 * from the MP3 byte length, since the stream is 128 kbps CBR); before granting
 * voice we check the running total for the current billing period against the
 * tier's monthly cap. When the cap is reached, callers return 402 and the client
 * falls back to text mode — never a hard block.
 *
 * The meter (table + RPCs) is written only via the service-role key. If the
 * service role isn't configured we FAIL OPEN (allow voice) so a misconfig never
 * silently bricks the core product.
 */

/** ElevenLabs stream/default output is mp3_44100_128 → 128 kbps = 16 KB/s. */
export const VOICE_MP3_BYTES_PER_SECOND = 16000;

/** Estimate spoken seconds from synthesized MP3 byte length. */
export function estimateTtsSeconds(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  return byteLength / VOICE_MP3_BYTES_PER_SECOND;
}

export type VoiceAllowance = {
  allowed: boolean;
  tier: PlanTier;
  capSeconds: number;
  usedSeconds: number;
  /** capSeconds + any top-up bonus, minus used (never negative). */
  remainingSeconds: number;
  periodStart: string;
  periodEnd: string | null;
};

/**
 * Billing-period anchor for usage. Paid users reset on Stripe's
 * current_period_start; free users reset on the 1st of the calendar month (UTC).
 */
function resolvePeriod(sub: {
  tier: PlanTier;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): { start: Date; end: string | null } {
  if (sub.tier !== "free" && sub.currentPeriodStart) {
    const start = new Date(sub.currentPeriodStart);
    if (!Number.isNaN(start.getTime())) {
      return { start, end: sub.currentPeriodEnd };
    }
  }
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { start, end: end.toISOString() };
}

async function isVoiceCapExemptUser(
  userId: string,
  email?: string | null
): Promise<boolean> {
  // Local dev: never meter voice — avoids false 402s when admin env isn't wired.
  if (process.env.NODE_ENV === "development") return true;

  if (isAppAdminEnvUser({ id: userId, email })) return true;

  const admin = createAdminClient();
  if (!admin) return false;

  const { data } = await admin
    .from("app_super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/** Check whether the user may use voice right now (reads usage, doesn't mutate). */
export async function checkVoiceAllowance(
  userId: string,
  opts?: { email?: string | null }
): Promise<VoiceAllowance> {
  const sub = await getUserSubscription(userId);
  const capSeconds = voiceCapSeconds(sub.tier);
  const { start, end } = resolvePeriod(sub);

  if (await isVoiceCapExemptUser(userId, opts?.email)) {
    return {
      allowed: true,
      tier: sub.tier,
      capSeconds,
      usedSeconds: 0,
      remainingSeconds: Number.MAX_SAFE_INTEGER,
      periodStart: start.toISOString(),
      periodEnd: end,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    // Fail open: never brick voice on a billing misconfiguration.
    return {
      allowed: true,
      tier: sub.tier,
      capSeconds,
      usedSeconds: 0,
      remainingSeconds: capSeconds,
      periodStart: start.toISOString(),
      periodEnd: end,
    };
  }

  const { data, error } = await admin.rpc("voice_usage_get", {
    p_user_id: userId,
    p_period_start: start.toISOString(),
  });
  const row = Array.isArray(data) ? data[0] : data;
  const used = error || !row ? 0 : Number(row.seconds_used ?? 0);
  const bonus = error || !row ? 0 : Number(row.bonus_seconds ?? 0);

  const remaining = Math.max(0, capSeconds + bonus - used);
  return {
    allowed: remaining > 0,
    tier: sub.tier,
    capSeconds,
    usedSeconds: used,
    remainingSeconds: remaining,
    periodStart: start.toISOString(),
    periodEnd: end,
  };
}

/**
 * Record consumed voice seconds for the user's current period. Best-effort:
 * logs and swallows errors so a metering hiccup never breaks playback.
 */
export async function recordVoiceSeconds(
  userId: string,
  seconds: number
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const admin = createAdminClient();
  if (!admin) return;

  const sub = await getUserSubscription(userId);
  const { start } = resolvePeriod(sub);

  const { error } = await admin.rpc("voice_usage_consume", {
    p_user_id: userId,
    p_seconds: seconds,
    p_period_start: start.toISOString(),
  });
  if (error) {
    // Fail open for playback, but surface the metering gap: unrecorded seconds
    // mean the user's cap is under-counted until this is investigated.
    await report("billing.record_voice_seconds_failed", error, {
      userId,
      detail: { seconds, periodStart: start.toISOString() },
    });
  }
}
