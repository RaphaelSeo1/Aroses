"use client";

import { useDashboardAdminNav } from "@/components/DashboardAdminNavContext";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { LogoutButton } from "@/components/LogoutButton";
import { TutorSessionNavDropdown } from "@/components/TutorSessionNavDropdown";
import { useSrsDueCounts, type SrsDueCounts } from "@/lib/srs-due";

/**
 * Same primary navigation on every authenticated screen. Home is your workspace (`/`).
 */
export function HeaderNavLoggedIn({
  courseHomeHref,
  adminHubHref: adminHubHrefProp,
  initialDueCounts,
}: {
  /** Show when studying — links back to uploads/workspace for this course. */
  courseHomeHref?: string;
  /** Creator-only admin hub (`/dashboard/admin`), when env allowlist matches. */
  adminHubHref?: string;
  /** SSR due counts so the Review badge renders on first paint. */
  initialDueCounts?: SrsDueCounts;
}) {
  const dashboardNav = useDashboardAdminNav();
  const adminHubHref = adminHubHrefProp ?? dashboardNav?.adminHubHref;
  const { counts: dueCounts } = useSrsDueCounts(undefined, {
    enabled: true,
    initialCounts: initialDueCounts,
  });
  const dueTotal = dueCounts?.total ?? initialDueCounts?.total ?? 0;
  const badgeLabel = dueTotal > 99 ? "99+" : String(dueTotal);
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
      <TutorSessionNavDropdown />
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
        <span
          aria-label={
            dueTotal > 0 ? `${dueTotal} cards due` : "No cards due for review"
          }
          className={`ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
            dueTotal > 0
              ? "bg-brand text-white"
              : "bg-zinc-200/90 text-zinc-500 dark:bg-white/10 dark:text-zinc-400"
          }`}
        >
          {badgeLabel}
        </span>
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
