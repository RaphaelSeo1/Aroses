"use client";

import { useDashboardAdminNav } from "@/components/DashboardAdminNavContext";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { TutorSessionNavDropdown } from "@/components/TutorSessionNavDropdown";
import { AvatarMenu } from "@/components/nav/AvatarMenu";
import { MobileNavMenu } from "@/components/nav/MobileNavMenu";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { useSrsDueCounts, type SrsDueCounts } from "@/lib/srs-due";

/**
 * Primary navigation on every authenticated screen.
 *
 * Layout:
 *   - Desktop (≥ lg): Home · Tutor Session ▾ · Explore · Forum · Review (icon
 *     + due-count badge), then the avatar account menu on the right.
 *   - Mobile (< lg): the primary links collapse into a hamburger; the avatar
 *     menu stays visible so account actions remain reachable.
 */
export function HeaderNavLoggedIn({
  courseHomeHref,
  adminHubHref: adminHubHrefProp,
  initialDueCounts,
  displayName,
  email,
  avatarUrl,
}: {
  /** Show when studying — links back to uploads/workspace for this course. */
  courseHomeHref?: string;
  /** Creator-only admin hub (`/dashboard/admin`), when env allowlist matches. */
  adminHubHref?: string;
  /** SSR due counts so the Review badge renders on first paint. */
  initialDueCounts?: SrsDueCounts;
  /** Profile bits for the avatar menu (fetched server-side). */
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}) {
  const t = useT();
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
      <MobileNavMenu
        dueTotal={dueTotal}
        badgeLabel={badgeLabel}
        courseHomeHref={courseHomeHref}
      />

      <div className="hidden items-center gap-1.5 lg:flex lg:gap-2">
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
          <span>{t.nav.home}</span>
        </HeaderNavLink>
        <TutorSessionNavDropdown />
        <HeaderNavLink href="/explore">{t.nav.explore}</HeaderNavLink>
        <HeaderNavLink href="/forum">{t.nav.forum}</HeaderNavLink>
        <HeaderNavLink
          href="/dashboard/review"
          activeWhen={(p) => p.startsWith("/dashboard/review")}
          className="relative inline-flex items-center gap-1"
          aria-label={
            dueTotal > 0
              ? tf(t.nav.reviewAriaDue, { count: dueTotal })
              : t.nav.review
          }
          title={
            dueTotal > 0
              ? tf(t.nav.reviewCardsDue, { count: dueTotal })
              : t.nav.reviewSpacedRepetition
          }
        >
          <svg
            className="h-5 w-5 shrink-0 opacity-80"
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
          <span
            aria-hidden
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
              dueTotal > 0
                ? "bg-brand text-white"
                : "bg-zinc-200/90 text-zinc-500 dark:bg-white/10 dark:text-zinc-400"
            }`}
          >
            {badgeLabel}
          </span>
        </HeaderNavLink>
        {courseHomeHref ? (
          <HeaderNavLink href={courseHomeHref}>{t.nav.courseHome}</HeaderNavLink>
        ) : null}
      </div>

      <AvatarMenu
        displayName={displayName}
        email={email}
        avatarUrl={avatarUrl}
        adminHubHref={adminHubHref}
      />
    </>
  );
}
