import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_NAME, INTRO_HREF } from "@/lib/brand";

/** Selected / emphasized nav pill (active route). */
export const HEADER_NAV_ACCENT =
  "inline-flex items-center justify-center rounded-full px-3 py-2 text-sm font-semibold text-brand bg-brand-blush/95 shadow-sm shadow-brand/10 hover:bg-brand-blush dark:bg-white/[0.14] dark:text-white dark:shadow-none dark:ring-1 dark:ring-brand-soft/45 dark:hover:bg-white/[0.18]";

/** Neutral pill — inactive nav links */
export const HEADER_NAV_NEUTRAL =
  "inline-flex items-center justify-center rounded-full px-3 py-2 text-sm font-medium text-brand-muted hover:bg-brand-blush hover:text-brand-ink dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-100";

/** Solid CTA — Sign up */
export const HEADER_NAV_PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-brand px-3 py-2 text-sm font-medium text-white shadow-md shadow-red-600/20 hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-hover";

export function AppHeader({
  right,
}: {
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-brand-border bg-white/90 backdrop-blur-md dark:border-brand-border/30 dark:bg-[#141110]/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
        <Link
          href={INTRO_HREF}
          aria-label={`${APP_NAME} — intro`}
          className="group flex min-w-max shrink-0 items-center gap-2.5 sm:gap-3"
        >
          <BrandLogo
            className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
            priority
          />
          <span className="font-serif text-lg font-bold tracking-tight text-brand-ink dark:text-white sm:text-xl">
            {APP_NAME}
          </span>
        </Link>
        <nav className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {right}
        </nav>
      </div>
    </header>
  );
}
