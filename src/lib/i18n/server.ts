import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  DEFAULT_UI_LOCALE,
  UI_LOCALE_COOKIE,
  isUiLocale,
  isUiLocaleSwitcherEnabled,
  type UiLocale,
} from "@/lib/i18n/config";
import { WIDGET_SUPABASE_TIMEOUT_MS } from "@/lib/supabase/bounded-fetch";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, type Dictionary } from "@/locales";

/**
 * Resolve the UI language for this request: cookie first, then the signed-in
 * profile preference (covers a fresh device before any cookie exists).
 */
export const getUiLocale = cache(async (): Promise<UiLocale> => {
  const store = await cookies();
  const fromCookie = store.get(UI_LOCALE_COOKIE)?.value;
  if (isUiLocale(fromCookie)) return fromCookie;
  // Only English is offered today — skip a Supabase round-trip that used to
  // hold the root layout for up to 5s when the cookie was missing.
  if (!isUiLocaleSwitcherEnabled()) return DEFAULT_UI_LOCALE;

  try {
    const supabase = await createClient({ timeoutMs: WIDGET_SUPABASE_TIMEOUT_MS });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from("profiles")
        .select("ui_locale")
        .eq("id", user.id)
        .maybeSingle();
      const fromProfile = (data as { ui_locale?: string } | null)?.ui_locale;
      if (isUiLocale(fromProfile)) return fromProfile;
    }
  } catch {
    // Missing column / table or transient auth error — fall back to default.
  }

  return DEFAULT_UI_LOCALE;
});

/** Server-component translation dictionary for the current request locale. */
export async function getT(): Promise<Dictionary> {
  return getDictionary(await getUiLocale());
}
