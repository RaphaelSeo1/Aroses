import "server-only";
import { cookies } from "next/headers";
import { validTimeZone, type LimitCopy } from "@/lib/billing/limit-messages";
import { DEFAULT_UI_LOCALE, TIME_ZONE_COOKIE } from "@/lib/i18n/config";
import { getUiLocale } from "@/lib/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The student's app language and time zone for plan-limit messages.
 * Time zone: the profile's saved zone, else the browser zone cookie, else
 * none (messages then show UTC, labeled). Never throws; outside a request
 * (cron / background work) it falls back to the default language + profile.
 */
export async function getLimitCopy(
  userId: string | null | undefined
): Promise<LimitCopy> {
  const [locale, profileZone, cookieZone] = await Promise.all([
    getUiLocale().catch(() => DEFAULT_UI_LOCALE),
    profileTimeZone(userId),
    browserTimeZone(),
  ]);
  return { locale, timeZone: profileZone ?? cookieZone };
}

async function profileTimeZone(
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  try {
    const { data } = await admin
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    return validTimeZone((data as { timezone?: unknown } | null)?.timezone);
  } catch {
    return null;
  }
}

async function browserTimeZone(): Promise<string | null> {
  try {
    const raw = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
    return raw ? validTimeZone(decodeURIComponent(raw)) : null;
  } catch {
    return null;
  }
}
