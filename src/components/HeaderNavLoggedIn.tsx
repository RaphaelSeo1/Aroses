"use client";

import { HeaderNavLink } from "@/components/HeaderNavLink";
import { LogoutButton } from "@/components/LogoutButton";

/**
 * Same primary navigation on every authenticated screen so items never “disappear”
 * when switching routes (e.g. Explore vs dashboard). Home opens the marketing site (/).
 */
export function HeaderNavLoggedIn({
  courseHomeHref,
}: {
  /** Show when studying — links back to uploads/workspace for this course. */
  courseHomeHref?: string;
}) {
  return (
    <>
      <HeaderNavLink
        href="/"
        match="exact"
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
        href="/dashboard"
        activeWhen={(p) =>
          p === "/dashboard" || p.startsWith("/dashboard/courses")
        }
      >
        Courses
      </HeaderNavLink>
      <HeaderNavLink href="/explore">Explore</HeaderNavLink>
      <HeaderNavLink
        href="/dashboard/profile"
        activeWhen={(p) => p === "/dashboard/profile"}
      >
        Profile
      </HeaderNavLink>
      {courseHomeHref ? (
        <HeaderNavLink href={courseHomeHref}>Course home</HeaderNavLink>
      ) : null}
      <LogoutButton />
    </>
  );
}
