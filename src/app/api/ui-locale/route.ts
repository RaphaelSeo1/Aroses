import { NextResponse } from "next/server";
import {
  UI_LOCALE_COOKIE,
  UI_LOCALE_COOKIE_MAX_AGE,
  isUiLocale,
} from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";

/** Persist the UI language choice: cookie for everyone, profile if signed in. */
export async function POST(request: Request) {
  let locale: unknown;
  try {
    locale = ((await request.json()) as { locale?: unknown }).locale;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isUiLocale(locale)) {
    return NextResponse.json({ error: "Unsupported locale" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(UI_LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: UI_LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  // Best-effort cross-device sync; ignore failures (e.g. migration not run yet).
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ ui_locale: locale })
        .eq("id", user.id);
    }
  } catch {
    // Cookie alone is enough for the UI to switch.
  }

  return res;
}
