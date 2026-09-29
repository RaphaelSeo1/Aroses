import "server-only";
import type { ChatMeterStore } from "@/lib/billing/chat-limits";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Supabase side of the per-period plan meters in `plan_meter_usage`
 * (migration 119): live lecture seconds and extra-question clicks. Same row
 * rules as the chat meter — a newer period resets the counter, an older one
 * keeps counting the stored period.
 *
 * Every call throws `MeterUnavailableError` (or returns null) while the
 * migration is missing, so callers can fail open.
 */

export type PlanMeter = "lecture_seconds" | "extra_questions";

type RpcError = { code?: string; message?: string } | null;

export class MeterUnavailableError extends Error {}

const warned = new Set<PlanMeter>();

export function isMissingPlanMeter(error: RpcError): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return true;
  }
  return /plan_meter_(reserve|refund|get|usage)|schema cache/i.test(error.message ?? "");
}

export function warnPlanMeterMissing(meter: PlanMeter): void {
  if (warned.has(meter)) return;
  warned.add(meter);
  console.warn(
    `[billing] ${meter} meter unavailable (apply migration 119_plan_meter_usage.sql) — failing open`
  );
}

type ReserveRow = {
  allowed?: boolean;
  used?: number;
  counted_period_start?: string;
};

/** Count-style store (one unit per reserve) for the shared reservation flow. */
export function planCountMeterStore(meter: PlanMeter): ChatMeterStore | null {
  const admin = createAdminClient();
  if (!admin) return null;
  return {
    async reserve({ userId, periodStart, cap }) {
      const { data, error } = await admin.rpc("plan_meter_reserve", {
        p_user_id: userId,
        p_meter: meter,
        p_period_start: periodStart,
        p_amount: 1,
        p_cap: cap,
      });
      if (error) {
        if (isMissingPlanMeter(error)) throw new MeterUnavailableError(error.message);
        throw error;
      }
      const row = (Array.isArray(data) ? data[0] : data) as ReserveRow | null | undefined;
      if (!row || typeof row.allowed !== "boolean") {
        throw new Error("plan_meter_reserve returned no row");
      }
      return {
        allowed: row.allowed,
        used: Number(row.used ?? 0),
        periodStart: row.counted_period_start
          ? new Date(row.counted_period_start).toISOString()
          : periodStart,
      };
    },
    async refund({ userId, periodStart }) {
      const { error } = await admin.rpc("plan_meter_refund", {
        p_user_id: userId,
        p_meter: meter,
        p_period_start: periodStart,
        p_amount: 1,
      });
      if (error) throw error;
    },
  };
}

/** Add usage without a cap check. False when the meter isn't available. */
export async function planMeterConsume(
  userId: string,
  meter: PlanMeter,
  periodStart: string,
  amount: number
): Promise<boolean> {
  if (!Number.isFinite(amount) || amount <= 0) return true;
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.rpc("plan_meter_reserve", {
    p_user_id: userId,
    p_meter: meter,
    p_period_start: periodStart,
    p_amount: amount,
    p_cap: null,
  });
  if (error) {
    if (isMissingPlanMeter(error)) {
      warnPlanMeterMissing(meter);
      return false;
    }
    throw error;
  }
  return true;
}

/** Usage this period, or null when the meter isn't available. */
export async function planMeterGet(
  userId: string,
  meter: PlanMeter,
  periodStart: string
): Promise<number | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("plan_meter_get", {
    p_user_id: userId,
    p_meter: meter,
    p_period_start: periodStart,
  });
  if (error) {
    if (isMissingPlanMeter(error)) warnPlanMeterMissing(meter);
    else console.error(`[billing] plan_meter_get ${meter}`, error);
    return null;
  }
  const n = Number(Array.isArray(data) ? data[0] : data);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
