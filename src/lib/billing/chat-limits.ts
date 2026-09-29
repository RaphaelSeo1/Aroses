import { PLAN_ORDER, PLANS, TOP_PLAN_TIER, type PlanTier } from "./plans.ts";

/**
 * Monthly per-student chat message caps. The defaults live with every other
 * allowance in `plans.ts` (`chatMessages` / `chatPremiumMessages`).
 *
 * Covers every text chat turn that calls the model once per student message:
 * Rose study chat, review chat, Mentored Learning turns, tutor sessions and
 * calendar Ask Rose. The first `premiumMessages` each billing period run on
 * the surface's normal (Sonnet) model; after that the same prompt runs on
 * Haiku until `monthlyMessages`, then chat pauses until the period resets.
 *
 * Env overrides (non-negative integers), per tier:
 *   CHAT_LIMIT_<TIER>_MESSAGES   total messages per billing period
 *   CHAT_LIMIT_<TIER>_SONNET     of those, how many use the premium (Sonnet) model
 * e.g. CHAT_LIMIT_STUDENT_MESSAGES=250. `CHAT_LIMITS_ENABLED=false` turns
 * the whole meter off (every message on the normal model, nothing counted).
 *
 * This module is pure (no DB) so the rules are unit-testable; the Supabase
 * store lives in `chat-usage.ts` and mirrors `InMemoryChatMeterStore`.
 */

export type ChatLimit = {
  /** Total chat messages per billing period. 0 = chat unavailable. */
  monthlyMessages: number;
  /** Leading messages per period on the premium model (<= monthlyMessages). */
  premiumMessages: number;
};

export const DEFAULT_CHAT_LIMITS: Record<PlanTier, ChatLimit> = Object.fromEntries(
  PLAN_ORDER.map((tier) => [
    tier,
    {
      monthlyMessages: PLANS[tier].limits.chatMessages,
      premiumMessages: PLANS[tier].limits.chatPremiumMessages,
    },
  ])
) as Record<PlanTier, ChatLimit>;

export const CHAT_LIMIT_REACHED_CODE = "chat_limit_reached";

type Env = Record<string, string | undefined>;

function envCount(env: Env, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

export function chatLimitsEnabled(env: Env = process.env): boolean {
  const raw = env.CHAT_LIMITS_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export function chatLimitForTier(
  tier: PlanTier,
  env: Env = process.env
): ChatLimit {
  const base = DEFAULT_CHAT_LIMITS[tier] ?? DEFAULT_CHAT_LIMITS.free;
  const key = tier.toUpperCase();
  const monthlyMessages =
    envCount(env, `CHAT_LIMIT_${key}_MESSAGES`) ?? base.monthlyMessages;
  const premiumMessages = Math.min(
    monthlyMessages,
    envCount(env, `CHAT_LIMIT_${key}_SONNET`) ?? base.premiumMessages
  );
  return { monthlyMessages, premiumMessages };
}

/** `ordinal` is the 1-based count of this message within the period. */
export function usesFallbackModel(ordinal: number, limit: ChatLimit): boolean {
  return ordinal > limit.premiumMessages;
}

/** When the current period's allowance resets (ISO). */
export function chatLimitResetsAt(period: {
  startIso: string;
  endIso: string | null;
}): string {
  if (period.endIso && !Number.isNaN(new Date(period.endIso).getTime())) {
    return new Date(period.endIso).toISOString();
  }
  const start = new Date(period.startIso);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

export function chatLimitReachedMessage(input: {
  tier: PlanTier;
  limit: ChatLimit;
  resetsAt: string;
  upgradeAvailable: boolean;
}): string {
  const date = new Date(input.resetsAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const n = input.limit.monthlyMessages;
  const head =
    n > 0
      ? `You've reached your monthly chat limit (${n} messages with Rose). It resets on ${date}.`
      : `Chat with Rose isn't included right now. It resets on ${date}.`;
  if (!input.upgradeAvailable || input.tier === TOP_PLAN_TIER) return head;
  return input.tier === "free"
    ? `${head} Choose a plan to get more messages each month.`
    : `${head} Upgrade your plan for more messages each month.`;
}

// ── Reservation flow ────────────────────────────────────────────────────────

export type ChatMeterReserveResult = {
  allowed: boolean;
  /** Messages counted this period, including this one when allowed. */
  used: number;
  /** Period the row was counted under (pass back to `refund`). */
  periodStart: string;
};

export interface ChatMeterStore {
  reserve(input: {
    userId: string;
    periodStart: string;
    cap: number;
  }): Promise<ChatMeterReserveResult>;
  refund(input: { userId: string; periodStart: string }): Promise<void>;
}

export type ChatQuotaAllowed = {
  allowed: true;
  /** True once the premium allowance is used up: run this turn on Haiku. */
  useFallbackModel: boolean;
  /** False when unmetered (disabled, exempt, or the meter is unavailable). */
  metered: boolean;
  used: number | null;
  limit: ChatLimit;
  /** Give the message back when the model call fails. Safe to call twice. */
  refund: () => Promise<void>;
};

export type ChatQuotaBlocked = {
  allowed: false;
  used: number;
  limit: ChatLimit;
  resetsAt: string;
  message: string;
};

export type ChatQuota = ChatQuotaAllowed | ChatQuotaBlocked;

const noopRefund = async () => {};

export async function reserveChatQuota(
  store: ChatMeterStore | null,
  input: {
    userId: string;
    tier: PlanTier;
    period: { startIso: string; endIso: string | null };
    unlimited: boolean;
    upgradeAvailable: boolean;
    env?: Env;
    onStoreError?: (error: unknown) => void;
  }
): Promise<ChatQuota> {
  const env = input.env ?? process.env;
  const limit = chatLimitForTier(input.tier, env);
  const unmetered: ChatQuotaAllowed = {
    allowed: true,
    useFallbackModel: false,
    metered: false,
    used: null,
    limit,
    refund: noopRefund,
  };
  if (!chatLimitsEnabled(env) || input.unlimited || !store) return unmetered;

  let result: ChatMeterReserveResult;
  try {
    result = await store.reserve({
      userId: input.userId,
      periodStart: input.period.startIso,
      cap: limit.monthlyMessages,
    });
  } catch (e) {
    // Fail open: a metering outage must never take chat down.
    input.onStoreError?.(e);
    return unmetered;
  }

  if (!result.allowed) {
    const resetsAt = chatLimitResetsAt(input.period);
    return {
      allowed: false,
      used: result.used,
      limit,
      resetsAt,
      message: chatLimitReachedMessage({
        tier: input.tier,
        limit,
        resetsAt,
        upgradeAvailable: input.upgradeAvailable,
      }),
    };
  }

  let refunded = false;
  return {
    allowed: true,
    useFallbackModel: usesFallbackModel(result.used, limit),
    metered: true,
    used: result.used,
    limit,
    refund: async () => {
      if (refunded) return;
      refunded = true;
      try {
        await store.refund({
          userId: input.userId,
          periodStart: result.periodStart,
        });
      } catch (e) {
        input.onStoreError?.(e);
      }
    },
  };
}

/**
 * In-memory twin of the `chat_message_reserve` / `chat_message_refund` RPCs
 * (migration 117). Same rules: a newer period resets the counter, an older
 * one keeps counting the stored period, the cap is checked before counting.
 */
export class InMemoryChatMeterStore implements ChatMeterStore {
  private rows = new Map<string, { periodStart: string; used: number }>();

  async reserve(input: {
    userId: string;
    periodStart: string;
    cap: number;
  }): Promise<ChatMeterReserveResult> {
    let row = this.rows.get(input.userId);
    if (!row || Date.parse(row.periodStart) < Date.parse(input.periodStart)) {
      row = { periodStart: input.periodStart, used: 0 };
      this.rows.set(input.userId, row);
    }
    if (row.used >= Math.max(0, input.cap)) {
      return { allowed: false, used: row.used, periodStart: row.periodStart };
    }
    row.used += 1;
    return { allowed: true, used: row.used, periodStart: row.periodStart };
  }

  async refund(input: { userId: string; periodStart: string }): Promise<void> {
    const row = this.rows.get(input.userId);
    if (!row || row.periodStart !== input.periodStart || row.used <= 0) return;
    row.used -= 1;
  }

  usedFor(userId: string): number {
    return this.rows.get(userId)?.used ?? 0;
  }
}
