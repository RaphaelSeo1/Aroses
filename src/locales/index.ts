import type { UiLocale } from "@/lib/i18n/config";
import { auth } from "./auth";
import { billing } from "./billing";
import { common } from "./common";
import { courseBuild } from "./courseBuild";
import { dashboard } from "./dashboard";
import { explore } from "./explore";
import { forum } from "./forum";
import { help } from "./help";
import { immersive } from "./immersive";
import { landing } from "./landing";
import { legal } from "./legal";
import { messages } from "./messages";
import { nav } from "./nav";
import { onboarding } from "./onboarding";
import { productTour } from "./productTour";
import { progress } from "./progress";
import { review } from "./review";
import { sales } from "./sales";
import { settings } from "./settings";
import { social } from "./social";
import { study } from "./study";
import { tutor } from "./tutor";

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
    productTour: productTour[locale],
    dashboard: dashboard[locale],
    settings: settings[locale],
    study: study[locale],
    explore: explore[locale],
    review: review[locale],
    billing: billing[locale],
    sales: sales[locale],
    social: social[locale],
    tutor: tutor[locale],
    immersive: immersive[locale],
    courseBuild: courseBuild[locale],
    forum: forum[locale],
    messages: messages[locale],
    legal: legal[locale],
    progress: progress[locale],
    help: help[locale],
  };
}

export type Dictionary = ReturnType<typeof getDictionary>;
