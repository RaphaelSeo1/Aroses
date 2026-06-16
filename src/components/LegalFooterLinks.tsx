"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { tf } from "@/lib/i18n/format";
import { useT } from "@/lib/i18n/LocaleProvider";

/** Inline footer links to legal documents — update `src/lib/legal-contact.ts` for contact email. */
export function LegalFooterLinks({
  className = "",
}: {
  className?: string;
}) {
  const t = useT();
  const navClass = [
    "flex flex-col items-center gap-3",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={navClass}>
      <Link
        href="/help"
        className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-blush/60 px-4 py-2 text-sm font-semibold text-brand transition hover:border-brand/50 hover:bg-brand-blush dark:bg-brand-blush/10 dark:hover:bg-brand-blush/20"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
        </svg>
        {tf(t.legal.learnHow, { app: APP_NAME })}
      </Link>
      <nav
        className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-zinc-600 dark:text-zinc-400"
        aria-label="Legal"
      >
        <Link href="/legal/terms" className="hover:text-brand dark:hover:text-brand-soft">
          {t.legal.terms}
        </Link>
        <Link
          href="/legal/privacy"
          className="hover:text-brand dark:hover:text-brand-soft"
        >
          {t.legal.privacy}
        </Link>
        <Link href="/legal/dmca" className="hover:text-brand dark:hover:text-brand-soft">
          {t.legal.dmca}
        </Link>
      </nav>
    </div>
  );
}
