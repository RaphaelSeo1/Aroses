"use client";

import type { HonestFaqItem } from "@/lib/help-honest-faq";
import { getHonestFaqItems, getHelpAppFaqItems } from "@/lib/help-honest-faq";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { HelpRichText } from "@/components/help/HelpRichText";

function FaqBlock({ item }: { item: HonestFaqItem }) {
  return (
    <div id={`faq-${item.id}`} className="scroll-mt-28 border-b border-zinc-100 pb-8 last:border-0 dark:border-zinc-800/80">
      <h3 className="text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {item.question}
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {item.paragraphs.map((p, i) => (
          <p key={i}>
            <HelpRichText text={p} />
          </p>
        ))}
        {item.bullets?.length ? (
          <ul className="list-disc space-y-2 pl-5">
            {item.bullets.map((b, i) => (
              <li key={i}>
                <HelpRichText text={b} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function HonestFaqSection() {
  const locale = useLocale();
  const t = useT().help.faq;

  return (
    <section id="faq" className="mt-16 scroll-mt-28 pb-8">
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t.title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm italic text-zinc-500 dark:text-zinc-500">
        {t.subtitle}
      </p>

      <div className="mt-8 space-y-0">
        {getHonestFaqItems(locale).map((item) => (
          <FaqBlock key={item.id} item={item} />
        ))}
      </div>

      <h3 className="mt-12 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {t.appTitle}
      </h3>
      <p className="mt-1 text-sm text-zinc-500">{t.appSubtitle}</p>
      <div className="mt-6 space-y-0">
        {getHelpAppFaqItems(locale).map((item) => (
          <FaqBlock key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
