/**
 * UI locale config — the language of the app chrome (nav, buttons, settings).
 * Separate from course output language (`courses.output_language`), which
 * controls what language AI-generated lessons are written in.
 *
 * Korean locale files remain in `src/locales/*` for a later re-enable; only
 * English is offered in the UI for now.
 *
 * Adding a language: add the code here, create/register locale strings, and
 * extend the DB check constraint.
 */
export const UI_LOCALES = ["en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "en";

/** Cookie that pins the UI language for both anonymous and signed-in visitors. */
export const UI_LOCALE_COOKIE = "ui_locale";

/** One year — the preference should effectively never expire. */
export const UI_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The browser's IANA time zone, written by `TIME_ZONE_COOKIE_SCRIPT` on every
 * page load so server-built text (e.g. plan-limit reset times) can use local
 * time when the profile has no time zone.
 */
export const TIME_ZONE_COOKIE = "tz";

export const TIME_ZONE_COOKIE_SCRIPT = `try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z){var v=encodeURIComponent(z);if(document.cookie.indexOf("${TIME_ZONE_COOKIE}="+v)<0)document.cookie="${TIME_ZONE_COOKIE}="+v+";path=/;max-age=${UI_LOCALE_COOKIE_MAX_AGE};samesite=lax";}}catch(e){}`;

export function isUiLocale(value: unknown): value is UiLocale {
  return (
    typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value)
  );
}

/** Dropdown entries — each label is written in its own language. */
export const UI_LOCALE_OPTIONS: ReadonlyArray<{
  value: UiLocale;
  label: string;
}> = [{ value: "en", label: "English" }];

/** True when more than one UI language is offered (controls switcher visibility). */
export function isUiLocaleSwitcherEnabled(): boolean {
  return UI_LOCALE_OPTIONS.length > 1;
}
