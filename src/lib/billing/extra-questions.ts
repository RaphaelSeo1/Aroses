import {
  chatLimitResetsAt,
  type ChatMeterReserveResult,
  type ChatMeterStore,
} from "./chat-limits.ts";
import { extraQuestionsUsedUpMessage } from "./limit-messages.ts";
import { extraQuestionCap, type PlanTier } from "./plans.ts";

/**
 * Monthly "Generate more questions" + "focus questions" clicks. One click is
 * reserved before the AI call and refunded if it fails, with the same store
 * contract and fail-open rules as the chat meter. Pure; the Supabase store
 * is `planCountMeterStore("extra_questions")`.
 */

export const EXTRA_QUESTIONS_LIMIT_CODE = "extra_questions_limit_reached";

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
  used: number;
  cap: number;
  resetsAt: string;
  message: string;
};

export type ExtraQuestionQuota =
  | ExtraQuestionQuotaAllowed
  | ExtraQuestionQuotaBlocked;

const noopRefund = async () => {};

export async function reserveExtraQuestionQuota(
  store: ChatMeterStore | null,
  input: {
    userId: string;
    tier: PlanTier;
    period: { startIso: string; endIso: string | null };
    unlimited: boolean;
    env?: Env;
    onStoreError?: (error: unknown) => void;
  }
): Promise<ExtraQuestionQuota> {
  const cap = extraQuestionCap(input.tier, input.env ?? process.env);
  const unmetered: ExtraQuestionQuotaAllowed = {
    allowed: true,
    metered: false,
    used: null,
    cap,
    refund: noopRefund,
  };
  if (input.unlimited || !store) return unmetered;

  let result: ChatMeterReserveResult;
  try {
    result = await store.reserve({
      userId: input.userId,
      periodStart: input.period.startIso,
      cap,
    });
  } catch (e) {
    input.onStoreError?.(e);
    return unmetered;
  }

  if (!result.allowed) {
    const resetsAt = chatLimitResetsAt(input.period);
    return {
      allowed: false,
      used: result.used,
      cap,
      resetsAt,
      message: extraQuestionsUsedUpMessage({
        tier: input.tier,
        cap,
        periodEnd: resetsAt,
      }),
    };
  }

  let refunded = false;
  return {
    allowed: true,
    metered: true,
    used: result.used,
    cap,
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
