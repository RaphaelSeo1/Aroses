"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * Hamburger menu holding the primary nav on small screens (< lg). The avatar
 * menu (account actions) lives separately and stays visible at all sizes, so
 * everything is still reachable on mobile. Mirrors the click-outside + Esc
 * behavior of the other header dropdowns.
 */
export function MobileNavMenu({
  dueTotal,
  badgeLabel,
  courseHomeHref,
}: {
  dueTotal: number;
  badgeLabel: string;
  courseHomeHref?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const tutorActive =
    pathname === "/tutor-session" ||
    pathname.startsWith("/tutor-session/") ||
    pathname.startsWith("/sessions");

  return (
    <div ref={containerRef} className="relative inline-block lg:hidden">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.nav.menu}
        data-tour="nav-menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-brand-muted transition hover:bg-brand-blush hover:text-brand-ink dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {open ? (
            <path d="M6 6l12 12M18 6l-12 12" />
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t.nav.navigation}
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10 ring-1 ring-zinc-900/[0.04] dark:border-zinc-700 dark:bg-zinc-900 dark:ring-white/10"
        >
          <MobileRow
            href="/"
            label={t.nav.home}
            onClick={close}
            active={
              pathname === "/" ||
              pathname === "/dashboard" ||
              pathname.startsWith("/dashboard/courses")
            }
            icon={
              <>
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </>
            }
          />
          <MobileRow
            href="/tutor-session"
            label={t.nav.tutorSession}
            onClick={close}
            active={tutorActive}
            icon={
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            }
          />
          <Link
            href="/sessions"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 py-2 pl-10 pr-3.5 text-[13px] text-zinc-500 transition hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t.nav.previousSessions}
          </Link>
          <MobileRow
            href="/explore"
            label={t.nav.explore}
            onClick={close}
            active={pathname === "/explore" || pathname.startsWith("/explore/")}
            icon={
              <>
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </>
            }
          />
          <MobileRow
            href="/forum"
            label={t.nav.forum}
            onClick={close}
            active={pathname === "/forum" || pathname.startsWith("/forum/")}
            icon={
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            }
          />
          <MobileRow
            href="/dashboard/review"
            label={t.nav.review}
            onClick={close}
            active={pathname.startsWith("/dashboard/review")}
            badge={badgeLabel}
            badgeActive={dueTotal > 0}
            icon={
              <>
                <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 5 7.5V21h6v-3.5c3-1.5 5-4 5-7.5a8 8 0 0 0-8-8Z" />
                <path d="M9 21h6" />
              </>
            }
          />
          {courseHomeHref ? (
            <MobileRow
              href={courseHomeHref}
              label={t.nav.courseHome}
              onClick={close}
              active={false}
              icon={
                <>
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <path d="M9 22V12h6v10" />
                </>
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MobileRow({
  href,
  label,
  icon,
  active,
  badge,
  badgeActive,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: string;
  badgeActive?: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      prefetch
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-brand-blush/95 text-brand dark:bg-white/[0.14] dark:text-white"
          : "text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
      }`}
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
        {icon}
      </svg>
      <span className="flex-1">{label}</span>
      {badge ? (
        <span
          className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
            badgeActive
              ? "bg-brand text-white"
              : "bg-zinc-200/90 text-zinc-500 dark:bg-white/10 dark:text-zinc-400"
          }`}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
