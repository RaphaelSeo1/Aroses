import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_NAME } from "@/lib/brand";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Accent pill — Explore (stands out from neutrals). */
export const HEADER_NAV_ACCENT =
  "inline-flex items-center justify-center rounded-full px-3 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand-blush dark:text-brand-soft dark:hover:bg-brand-blush/15";

/** Neutral pill — Dashboard, My courses, Log in, … */
export const HEADER_NAV_NEUTRAL =
  "inline-flex items-center justify-center rounded-full px-3 py-2 text-sm font-medium text-brand-muted transition-colors hover:bg-brand-blush hover:text-brand-ink dark:text-brand-soft dark:hover:bg-white/5 dark:hover:text-white";

/** Solid CTA — Sign up */
export const HEADER_NAV_PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-brand px-3 py-2 text-sm font-medium text-white shadow-md shadow-red-600/20 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-hover";

export function AppHeader({
  right,
}: {
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-brand-border bg-white/90 backdrop-blur-md dark:border-brand-border/30 dark:bg-[#141110]/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          aria-label={APP_NAME}
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
          <ThemeToggle />
          {right}
        </nav>
      </div>
    </header>
  );
}
