"use client";

import { HeaderNavLink } from "@/components/HeaderNavLink";
import { LogoutButton } from "@/components/LogoutButton";

/**
 * Same primary navigation on every authenticated screen. Home is your workspace (`/`).
 */
export function HeaderNavLoggedIn({
  courseHomeHref,
  adminHubHref,
}: {
  /** Show when studying — links back to uploads/workspace for this course. */
  courseHomeHref?: string;
  /** Creator-only admin hub (`/dashboard/admin`), when env allowlist matches. */
  adminHubHref?: string;
}) {
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
      <HeaderNavLink href="/explore">Explore</HeaderNavLink>
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
