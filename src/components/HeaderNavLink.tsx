"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HEADER_NAV_ACCENT,
  HEADER_NAV_NEUTRAL,
  HEADER_NAV_PRIMARY,
} from "@/components/AppHeader";

type Match = "exact" | "prefix";

function pathMatches(pathname: string, href: string, match: Match): boolean {
  if (match === "exact") return pathname === href;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function HeaderNavLink({
  href,
  children,
  match = "prefix",
  variant = "neutral",
  className = "",
  activeWhen,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  match?: Match;
  /** Override route matching (e.g. `/dashboard` vs `/dashboard/progress`). */
  activeWhen?: (pathname: string) => boolean;
  /** `neutral`: inactive uses muted pill, active uses brand accent. `primary`: solid CTA; active adds a ring. */
  variant?: "neutral" | "primary";
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className">) {
  const pathname = usePathname();
  const active = activeWhen
    ? activeWhen(pathname)
    : pathMatches(pathname, href, match);

  let cls: string;
  if (variant === "primary") {
    cls = active
      ? `${HEADER_NAV_PRIMARY} ring-2 ring-white/80 ring-offset-2 ring-offset-white dark:ring-brand-soft dark:ring-offset-[#141110]`
      : HEADER_NAV_PRIMARY;
  } else {
    cls = active ? HEADER_NAV_ACCENT : HEADER_NAV_NEUTRAL;
  }

  const merged = [cls, className].filter(Boolean).join(" ");
  return (
    <Link
      href={href}
      prefetch
      className={merged}
      aria-current={active ? "page" : undefined}
      {...rest}
    >
      {children}
    </Link>
  );
}
