"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HeaderNavLink } from "@/components/HeaderNavLink";

/**
 * Tutor Session nav: primary link to start a session, plus a compact
 * "Sessions" link to the library page (no heavy in-nav dropdown).
 */
export function TutorSessionNavDropdown() {
  const pathname = usePathname();

  return (
    <span className="inline-flex items-center gap-1">
      <HeaderNavLink
        href="/tutor-session"
        activeWhen={(p) =>
          p === "/tutor-session" || p.startsWith("/tutor-session/")
        }
        className="inline-flex items-center gap-1.5"
        title="Start a one-on-one tutor session with Rose"
      >
        <svg
          className="h-4 w-4 shrink-0 opacity-80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>Tutor Session</span>
      </HeaderNavLink>
      <Link
        href="/sessions"
        className={`rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${
          pathname.startsWith("/sessions")
            ? "bg-brand-blush/95 text-brand dark:bg-white/[0.14] dark:text-white"
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        }`}
        title="View your past tutor sessions"
      >
        Sessions
      </Link>
    </span>
  );
}
