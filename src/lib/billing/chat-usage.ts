import "server-only";
import { ANTHROPIC_HAIKU } from "@/lib/ai/anthropic-models";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import {
  CHAT_LIMIT_REACHED_CODE,
  reserveChatQuota,
  type ChatMeterStore,
  type ChatQuota,
  type ChatQuotaBlocked,
} from "@/lib/billing/chat-limits";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { getLimitCopy } from "@/lib/billing/limit-copy";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import { getUserSubscription } from "@/lib/billing/subscription";
import { isVoiceMinutesTurn } from "@/lib/billing/voice-usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { report } from "@/lib/report-error";

/**
 * Server-side chat message metering. Call `reserveChatMessage` right before
 * the model call of a student chat turn:
 *
 *   const quota = await reserveChatMessage(user);
 *   if (!quota.allowed) return chatLimitResponse(quota);
 *   try { await run({ model: chatModelOverride(quota) }) }
 *   catch (e) { await quota.refund(); throw e; }
 *
 * Fails open (unmetered, normal model) when the service role or migration 117
 * is missing, so a metering gap never takes chat down.
 */

type RpcError = { code?: string; message?: string } | null;

let warnedMissingMeter = false;

function isMissingMeter(error: RpcError): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return true;
  }
  return /chat_message_(reserve|refund|usage)|schema cache/i.test(error.message ?? "");
}

class MeterUnavailableError extends Error {}

function supabaseChatMeterStore(): ChatMeterStore | null {
  const admin = createAdminClient();
  if (!admin) return null;
  return {
    async reserve({ userId, periodStart, cap }) {
      const { data, error } = await admin.rpc("chat_message_reserve", {
        p_user_id: userId,
        p_period_start: periodStart,
        p_cap: cap,
      });
      if (error) {
        if (isMissingMeter(error)) throw new MeterUnavailableError(error.message);
        throw error;
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            allowed?: boolean;
            messages_count?: number;
            counted_period_start?: string;
          }
        | null
        | undefined;
      if (!row || typeof row.allowed !== "boolean") {
        throw new Error("chat_message_reserve returned no row");
      }
      return {
        allowed: row.allowed,
        used: Number(row.messages_count ?? 0),
        periodStart: row.counted_period_start
          ? new Date(row.counted_period_start).toISOString()
          : periodStart,
      };
    },
    async refund({ userId, periodStart }) {
      const { error } = await admin.rpc("chat_message_refund", {
        p_user_id: userId,
        p_period_start: periodStart,
      });
      if (error) throw error;
    },
  };
}

export async function reserveChatMessage(
  user: {
    id: string;
    email?: string | null;
  },
  opts?: {
    /**
     * The client says this Mentored Learning / tutor session turn is in voice
     * mode. Skips the chat meter only if voice minutes are really being
     * charged (`isVoiceMinutesTurn`).
     */
    voiceMode?: boolean;
  }
): Promise<ChatQuota> {
  const [sub, unlimited] = await Promise.all([
    getUserSubscription(user.id),
    isUnlimitedPlanMeterUser(user.id, user.email).catch(() => false),
  ]);
  const voiceTurn =
    opts?.voiceMode === true && !unlimited
      ? await isVoiceMinutesTurn(user.id, sub).catch(() => false)
      : false;
  const period = resolveBillingPeriod(sub);
  return reserveChatQuota(supabaseChatMeterStore(), {
    userId: user.id,
    tier: sub.tier,
    period: { startIso: period.startIso, endIso: period.endIso },
    unlimited,
    voiceTurn,
    copy: () => getLimitCopy(user.id),
    upgradeAvailable: isBillingUiEnabled(),
    onStoreError: (e) => {
      if (e instanceof MeterUnavailableError) {
        if (!warnedMissingMeter) {
          warnedMissingMeter = true;
          console.warn(
            "[billing] chat meter unavailable (apply migration 117_chat_message_usage.sql) — chat is unmetered"
          );
        }
        return;
      }
      void report("billing.chat_meter_failed", e, { userId: user.id });
    },
  });
}

/** Model id for this turn, or undefined to keep the surface's normal model. */
export function chatModelOverride(quota: ChatQuota): string | undefined {
  return quota.allowed && quota.useFallbackModel ? ANTHROPIC_HAIKU : undefined;
}

/**
 * 429 JSON the chat UIs already render through their error path
 * (`body.error` becomes the banner / Rose bubble). `error` is already in the
 * student's language and local time; `resetsAt` (ISO) lets a client format
 * the reset itself.
 */
export function chatLimitResponse(quota: ChatQuotaBlocked): Response {
  return new Response(
    JSON.stringify({
      error: quota.message,
      code: CHAT_LIMIT_REACHED_CODE,
      limit: quota.limit.monthlyMessages,
      used: quota.used,
      resetsAt: quota.resetsAt,
    }),
    {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }
  );
}
