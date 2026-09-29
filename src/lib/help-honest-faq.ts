/**
 * "Honest FAQ" copy for /help — straight answers, no hype.
 * Keep product-specific facts (pricing, privacy links) in sync with plans + legal pages.
 */

import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { PAID_PLAN_TIERS, PLANS, formatUsdAmount } from "@/lib/billing/plans";
import { salePriceMonthly } from "@/lib/billing/sale";
import { tf } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/config";
import { helpContent } from "@/locales/help-content";

export type HonestFaqItem = {
  id: string;
  question: string;
  paragraphs: string[];
  bullets?: string[];
};

const BILLING_ONLY_FAQ_IDS = new Set(["why-pay", "cancel"]);

/** `{litePrice}`, `{litePages}`, `{liteLecture}` … for every paid tier. */
function pricingVars(locale: UiLocale): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const tier of PAID_PLAN_TIERS) {
    const { sourcePages, lectureMinutes } = PLANS[tier].limits;
    const hours = Math.round((lectureMinutes / 60) * 10) / 10;
    vars[`${tier}Price`] = formatUsdAmount(salePriceMonthly(tier));
    vars[`${tier}Pages`] = sourcePages.toLocaleString("en-US");
    vars[`${tier}Lecture`] =
      (locale as string) === "ko" ? `${hours}시간` : hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return vars;
}

function resolveHonestItem(
  locale: UiLocale,
  item: (typeof helpContent.en.faq.honestItems)[number]
): HonestFaqItem {
  if (item.id === "why-pay") {
    return {
      id: item.id,
      question: item.question,
      paragraphs: [
        tf(helpContent[locale].faq.pricingParagraph, pricingVars(locale)),
      ],
    };
  }
  return {
    id: item.id,
    question: item.question,
    paragraphs: item.paragraphs,
    bullets: item.bullets,
  };
}

function resolveAppItem(
  locale: UiLocale,
  item: (typeof helpContent.en.faq.appItems)[number]
): HonestFaqItem {
  if (item.id === "voice-vs-text") {
    const paragraph = isBillingUiEnabled()
      ? item.paragraphWithBilling!
      : item.paragraphNoBilling!;
    return {
      id: item.id,
      question: item.question,
      paragraphs: [paragraph],
    };
  }
  return {
    id: item.id,
    question: item.question,
    paragraphs: item.paragraphs,
    bullets: item.bullets,
  };
}

/** Honest FAQ entries shown on /help (billing questions omitted when checkout is off). */
export function getHonestFaqItems(locale: UiLocale): HonestFaqItem[] {
  const items = helpContent[locale].faq.honestItems.map((item) =>
    resolveHonestItem(locale, item)
  );
  if (isBillingUiEnabled()) return items;
  return items.filter((i) => !BILLING_ONLY_FAQ_IDS.has(i.id));
}

/** Shorter, app-specific FAQs that complement the honest list. */
export function getHelpAppFaqItems(locale: UiLocale): HonestFaqItem[] {
  return helpContent[locale].faq.appItems.map((item) => resolveAppItem(locale, item));
}

/** @deprecated Use getHonestFaqItems(locale) */
export const HONEST_FAQ_ITEMS = getHonestFaqItems("en");

/** @deprecated Use getHelpAppFaqItems(locale) */
export const HELP_APP_FAQ_ITEMS = getHelpAppFaqItems("en");

/** @deprecated Read from help locale via useT().help.faq */
export const HONEST_FAQ_INTRO = helpContent.en.faq;
