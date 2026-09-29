import "server-only";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import {
  EXTRA_QUESTIONS_DAILY_LIMIT_CODE,
  EXTRA_QUESTIONS_LIMIT_CODE,
  reserveExtraQuestionQuota,
  type ExtraQuestionQuota,
  type ExtraQuestionQuotaBlocked,
} from "@/lib/billing/extra-questions";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import {
  MeterUnavailableError,
  planCountMeterStore,
  warnPlanMeterMissing,
} from "@/lib/billing/plan-meter-store";
import { getUserSubscription } from "@/lib/billing/subscription";
import { report } from "@/lib/report-error";

/**
 * Reserve one extra-question click right before the AI call:
 *
 *   const quota = await reserveExtraQuestionClick(user);
 *   if (!quota.allowed) return extraQuestionLimitResponse(quota);
 *   try { await generate() } catch (e) { await quota.refund(); throw e; }
 *
 * Also enforces the daily cap across both tools. Fails open (unmetered) until
 * migration 119 (monthly) / 120 (daily) is applied.
 */
export async function reserveExtraQuestionClick(user: {
  id: string;
  email?: string | null;
}): Promise<ExtraQuestionQuota> {
  const [sub, unlimited] = await Promise.all([
    getUserSubscription(user.id),
    isUnlimitedPlanMeterUser(user.id, user.email).catch(() => false),
  ]);
  const period = resolveBillingPeriod(sub);
  return reserveExtraQuestionQuota(planCountMeterStore("extra_questions"), {
    userId: user.id,
    tier: sub.tier,
    period: { startIso: period.startIso, endIso: period.endIso },
    unlimited,
    dailyStore: planCountMeterStore("extra_questions_daily"),
    onStoreError: (e) => {
      if (e instanceof MeterUnavailableError) {
        warnPlanMeterMissing(
          /plan_meter_usage_meter_check/i.test(e.message)
            ? "extra_questions_daily"
            : "extra_questions"
        );
        return;
      }
      void report("billing.extra_questions_meter_failed", e, { userId: user.id });
    },
  });
}

/** 429 JSON; both question UIs show `error` as their failure message. */
export function extraQuestionLimitResponse(
  quota: ExtraQuestionQuotaBlocked
): Response {
  return Response.json(
    {
      error: quota.message,
      code:
        quota.reason === "daily"
          ? EXTRA_QUESTIONS_DAILY_LIMIT_CODE
          : EXTRA_QUESTIONS_LIMIT_CODE,
      limit: quota.cap,
      used: quota.used,
      resetsAt: quota.resetsAt,
    },
    { status: 429 }
  );
}
