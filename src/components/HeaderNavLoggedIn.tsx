"use client";

import { useDashboardAdminNav } from "@/components/DashboardAdminNavContext";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { LogoutButton } from "@/components/LogoutButton";
import { useSrsDueCounts } from "@/lib/srs-due";

/**
 * Same primary navigation on every authenticated screen. Home is your workspace (`/`).
 */
export function HeaderNavLoggedIn({
  courseHomeHref,
  adminHubHref: adminHubHrefProp,
}: {
  /** Show when studying — links back to uploads/workspace for this course. */
  courseHomeHref?: string;
  /** Creator-only admin hub (`/dashboard/admin`), when env allowlist matches. */
  adminHubHref?: string;
}) {
  const dashboardNav = useDashboardAdminNav();
  const adminHubHref = adminHubHrefProp ?? dashboardNav?.adminHubHref;
  const { counts: dueCounts } = useSrsDueCounts(undefined, { enabled: true });
  const dueTotal = dueCounts?.total ?? 0;
  return (
    <>
      <HeaderNavLink
        href="/"
        activeWhen={(p) =>
          p === "/" ||
          p === "/dashboard" ||
          p.startsWith("/dashboard/courses")
        }
        className="inline-flex items-center gap-1.5"
      >
        <svg
          className="h-4 w-4 shrink-0 opacity-80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span>Home</span>
      </HeaderNavLink>
      <HeaderNavLink
        href="/tutor-session"
        activeWhen={(p) =>
          p === "/tutor-session" ||
          p.startsWith("/tutor-session/") ||
          p.startsWith("/sessions")
        }
        className="inline-flex items-center gap-1.5"
        title="Open a one-on-one tutor session with Rose"
      >
        <svg
          className="h-4 w-4 shrink-0 opacity-80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>Tutor Session</span>
      </HeaderNavLink>
      <HeaderNavLink href="/explore">Explore</HeaderNavLink>
      <HeaderNavLink
        href="/dashboard/review"
        activeWhen={(p) => p.startsWith("/dashboard/review")}
        className="relative inline-flex items-center gap-1.5"
        title={dueTotal > 0 ? `${dueTotal} cards due for review` : "Spaced repetition review"}
      >
        <svg
          className="h-4 w-4 shrink-0 opacity-80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 5 7.5V21h6v-3.5c3-1.5 5-4 5-7.5a8 8 0 0 0-8-8Z" />
          <path d="M9 21h6" />
        </svg>
        <span>Review</span>
        {dueTotal > 0 ? (
          <span
            aria-label={`${dueTotal} cards due`}
            className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums"
          >
            {dueTotal > 99 ? "99+" : dueTotal}
          </span>
        ) : null}
      </HeaderNavLink>
      <HeaderNavLink
        href="/dashboard/profile"
        activeWhen={(p) => p === "/dashboard/profile"}
      >
        Profile
      </HeaderNavLink>
      {adminHubHref ? (
        <HeaderNavLink
          href={adminHubHref}
          activeWhen={(p) => p.startsWith("/dashboard/admin")}
          title="Admin controls"
        >
          Admin
        </HeaderNavLink>
      ) : null}
      {courseHomeHref ? (
        <HeaderNavLink href={courseHomeHref}>Course home</HeaderNavLink>
      ) : null}
      <LogoutButton />
    </>
  );
}
