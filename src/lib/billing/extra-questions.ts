import {
  chatLimitResetsAt,
  resolveLimitCopy,
  type ChatMeterReserveResult,
  type ChatMeterStore,
} from "./chat-limits.ts";
import {
  extraQuestionsDailyLimitMessage,
  extraQuestionsUsedUpMessage,
  type LimitCopy,
} from "./limit-messages.ts";
import { extraQuestionCap, extraQuestionDailyCap, type PlanTier } from "./plans.ts";

/**
 * Monthly "Generate more questions" + "focus questions" clicks, plus a daily
 * abuse cap shared by both tools. One click is reserved before the AI call
 * and refunded if it fails, with the same store contract and fail-open rules
 * as the chat meter. Pure; the Supabase stores are
 * `planCountMeterStore("extra_questions")` and
 * `planCountMeterStore("extra_questions_daily")`.
 */

export const EXTRA_QUESTIONS_LIMIT_CODE = "extra_questions_limit_reached";
export const EXTRA_QUESTIONS_DAILY_LIMIT_CODE = "extra_questions_daily_limit_reached";

type Env = Record<string, string | undefined>;

export type ExtraQuestionQuotaAllowed = {
  allowed: true;
  /** False when unmetered (exempt or the meter is unavailable). */
  metered: boolean;
  used: number | null;
  cap: number;
  /** Give the click back when generation fails. Safe to call twice. */
  refund: () => Promise<void>;
};

export type ExtraQuestionQuotaBlocked = {
  allowed: false;
  /** Which limit was hit. */
  reason: "monthly" | "daily";
  used: number;
  cap: number;
  resetsAt: string;
  message: string;
};

export type ExtraQuestionQuota =
  | ExtraQuestionQuotaAllowed
  | ExtraQuestionQuotaBlocked;

const noopRefund = async () => {};

/** Start of the UTC day containing `now` (the daily meter's period). */
export function utcDayStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}

/** Next UTC midnight after `now`, when the daily cap resets. */
export function nextUtcDayStart(now: Date): string {
  return new Date(Date.parse(utcDayStart(now)) + 24 * 60 * 60 * 1000).toISOString();
}

type Reservation = { store: ChatMeterStore; userId: string; periodStart: string };

async function tryReserve(
  store: ChatMeterStore,
  input: { userId: string; periodStart: string; cap: number },
  onStoreError?: (error: unknown) => void
): Promise<ChatMeterReserveResult | null> {
  try {
    return await store.reserve(input);
  } catch (e) {
    onStoreError?.(e);
    return null;
  }
}

export async function reserveExtraQuestionQuota(
  store: ChatMeterStore | null,
  input: {
    userId: string;
    tier: PlanTier;
    period: { startIso: string; endIso: string | null };
    unlimited: boolean;
    /** Daily abuse-cap store; null/omitted skips the daily cap. */
    dailyStore?: ChatMeterStore | null;
    /** Student language + time zone for the limit message (only read when blocked). */
    copy?: LimitCopy | (() => Promise<LimitCopy>);
    now?: Date;
    env?: Env;
    onStoreError?: (error: unknown) => void;
  }
): Promise<ExtraQuestionQuota> {
  const env = input.env ?? process.env;
  const cap = extraQuestionCap(input.tier, env);
  const unmetered: ExtraQuestionQuotaAllowed = {
    allowed: true,
    metered: false,
    used: null,
    cap,
    refund: noopRefund,
  };
  if (input.unlimited) return unmetered;

  const reservations: Reservation[] = [];
  const refundAll = async () => {
    const pending = reservations.splice(0);
    for (const r of pending) {
      try {
        await r.store.refund({ userId: r.userId, periodStart: r.periodStart });
      } catch (e) {
        input.onStoreError?.(e);
      }
    }
  };

  let monthlyUsed: number | null = null;
  if (store) {
    const result = await tryReserve(
      store,
      { userId: input.userId, periodStart: input.period.startIso, cap },
      input.onStoreError
    );
    if (result && !result.allowed) {
      const resetsAt = chatLimitResetsAt(input.period);
      return {
        allowed: false,
        reason: "monthly",
        used: result.used,
        cap,
        resetsAt,
        message: extraQuestionsUsedUpMessage(
          { tier: input.tier, cap, periodEnd: resetsAt },
          await resolveLimitCopy(input.copy)
        ),
      };
    }
    if (result) {
      monthlyUsed = result.used;
      reservations.push({ store, userId: input.userId, periodStart: result.periodStart });
    }
  }

  if (input.dailyStore) {
    const now = input.now ?? new Date();
    const dailyCap = extraQuestionDailyCap(env);
    const result = await tryReserve(
      input.dailyStore,
      { userId: input.userId, periodStart: utcDayStart(now), cap: dailyCap },
      input.onStoreError
    );
    if (result && !result.allowed) {
      await refundAll();
      const resetsAt = nextUtcDayStart(now);
      return {
        allowed: false,
        reason: "daily",
        used: result.used,
        cap: dailyCap,
        resetsAt,
        message: extraQuestionsDailyLimitMessage(
          { cap: dailyCap, resetsAt, now },
          await resolveLimitCopy(input.copy)
        ),
      };
    }
    if (result) {
      reservations.push({
        store: input.dailyStore,
        userId: input.userId,
        periodStart: result.periodStart,
      });
    }
  }

  if (reservations.length === 0) return unmetered;

  return {
    allowed: true,
    metered: true,
    used: monthlyUsed,
    cap,
    refund: refundAll,
  };
}
