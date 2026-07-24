"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageToggleRow } from "@/components/LanguageSwitcher";
import { LogoutButton } from "@/components/LogoutButton";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import {
  formatBadgeCount,
  useSocialBadgeCounts,
  type SocialBadgeCounts,
} from "@/lib/social-badge";

/**
 * Top-right account menu. Click the avatar to open Profile / Social / Sales /
 * Admin (admins only) / Log out. Plans & billing lives under Profile.
 */
export function AvatarMenu({
  displayName,
  email,
  avatarUrl,
  adminHubHref,
  initialSocialCounts,
}: {
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  adminHubHref?: string;
  initialSocialCounts?: SocialBadgeCounts | null;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { counts: socialCounts } = useSocialBadgeCounts({
    initialCounts: initialSocialCounts,
  });
  const socialTotal = socialCounts.total;
  const socialBadge = formatBadgeCount(socialTotal);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const onAccountPage =
    pathname === "/dashboard/profile" ||
    (isMarketplaceUiEnabled() && pathname === "/dashboard/sales") ||
    pathname === "/dashboard/social" ||
    pathname.startsWith("/dashboard/admin");

  const initials = deriveInitials(displayName, email);
  const label = displayName?.trim() || email || t.nav.account;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          socialTotal > 0
            ? tf(t.nav.socialAriaBadge, { count: socialTotal })
            : t.nav.accountMenu
        }
        title={label}
        data-tour="nav-account"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition ${
          onAccountPage
            ? "ring-2 ring-brand ring-offset-2 ring-offset-white dark:ring-brand-soft dark:ring-offset-[#141110]"
            : "ring-1 ring-brand-border hover:ring-brand/50 dark:ring-white/15 dark:hover:ring-white/30"
        } ${
          avatarUrl
            ? "bg-zinc-100 dark:bg-zinc-800"
            : "bg-brand-blush text-brand dark:bg-white/10 dark:text-white"
        }`}
      >
        {/* Clip the photo/initials only — not the social badge that hangs off the corner. */}
        <span className="absolute inset-0 overflow-hidden rounded-full">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center" aria-hidden>
              {initials}
            </span>
          )}
        </span>
        {socialTotal > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 z-10 inline-flex min-w-[1.05rem] items-center justify-center rounded-full bg-brand px-1 py-0.5 text-[9px] font-bold leading-none text-white tabular-nums ring-2 ring-white dark:ring-[#141110]">
            {socialBadge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t.nav.accountOptions}
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10 ring-1 ring-zinc-900/[0.04] dark:border-zinc-700 dark:bg-zinc-900 dark:ring-white/10"
        >
          <div className="border-b border-zinc-100 px-3.5 py-2.5 dark:border-zinc-800">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {displayName?.trim() || t.nav.yourAccount}
            </p>
            {email ? (
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {email}
              </p>
            ) : null}
          </div>
          <Link
            href="/dashboard/profile"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg
              className="h-4 w-4 shrink-0 opacity-70"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {t.nav.profile}
          </Link>
          <Link
            href="/dashboard/social"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <svg
              className="h-4 w-4 shrink-0 opacity-70"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="flex-1">{t.nav.social}</span>
            {socialTotal > 0 ? (
              <span className="inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                {socialBadge}
              </span>
            ) : null}
          </Link>
          {isMarketplaceUiEnabled() ? (
            <Link
              href="/dashboard/sales"
              role="menuitem"
              onClick={close}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <svg
                className="h-4 w-4 shrink-0 opacity-70"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 4 3 5-6" />
              </svg>
              {t.nav.sales}
            </Link>
          ) : null}
          {adminHubHref ? (
            <Link
              href={adminHubHref}
              role="menuitem"
              onClick={close}
              title={t.nav.adminControls}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <svg
                className="h-4 w-4 shrink-0 opacity-70"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              {t.nav.admin}
            </Link>
          ) : null}
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          <LanguageToggleRow />
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          <LogoutButton className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800" />
        </div>
      ) : null}
    </div>
  );
}

function deriveInitials(
  displayName?: string | null,
  email?: string | null
): string {
  const name = displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
    const joined = letters.join("");
    if (joined) return joined;
  }
  const em = email?.trim();
  if (em) return em[0]!.toUpperCase();
  return "?";
}
