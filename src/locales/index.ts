import type { UiLocale } from "@/lib/i18n/config";
import { auth } from "./auth";
import { common } from "./common";
import { dashboard } from "./dashboard";
import { landing } from "./landing";
import { nav } from "./nav";
import { onboarding } from "./onboarding";
import { settings } from "./settings";
import { study } from "./study";

/**
 * Assemble the full UI dictionary for one locale. Every namespace file keeps
 * `ko` typed as `typeof en`, so a missing Korean key is a compile-time error.
 * Values are plain strings (JSON-serializable) so the dictionary can be
 * passed from server layouts into the client LocaleProvider.
 */
export function getDictionary(locale: UiLocale) {
  return {
    common: common[locale],
    nav: nav[locale],
    auth: auth[locale],
    landing: landing[locale],
    onboarding: onboarding[locale],
    dashboard: dashboard[locale],
    settings: settings[locale],
    study: study[locale],
  };
}

export type Dictionary = ReturnType<typeof getDictionary>;
