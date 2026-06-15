"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * Tutor Session nav with a chevron dropdown — compact menu only,
 * no inline session list (that lives on /sessions).
 */
export function TutorSessionNavDropdown() {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const active =
    pathname === "/tutor-session" ||
    pathname.startsWith("/tutor-session/") ||
    pathname.startsWith("/sessions");

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

  const pillVisual = active
    ? "font-semibold text-brand bg-brand-blush/95 shadow-sm shadow-brand/10 hover:bg-brand-blush dark:bg-white/[0.14] dark:text-white dark:shadow-none dark:ring-1 dark:ring-brand-soft/45 dark:hover:bg-white/[0.18]"
    : "font-medium text-brand-muted hover:bg-brand-blush hover:text-brand-ink dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-100";

  return (
    <div ref={containerRef} className="relative inline-block">
      <div
        className={`inline-flex items-center rounded-full py-2 pl-3 pr-2 text-sm transition ${pillVisual}`}
      >
        <Link
          href="/tutor-session"
          prefetch
          className="inline-flex items-center gap-1.5"
          title={t.nav.tutorSessionTitle}
          aria-current={active ? "page" : undefined}
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
          <span>{t.nav.tutorSession}</span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t.nav.tutorSessionMenu}
          className="-ml-px inline-flex w-4 shrink-0 items-center justify-center self-stretch opacity-70 transition hover:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {open ? (
        <div
          role="menu"
          aria-label={t.nav.tutorSessionOptions}
          className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10 ring-1 ring-zinc-900/[0.04] dark:border-zinc-700 dark:bg-zinc-900 dark:ring-white/10"
        >
          <Link
            href="/tutor-session"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <span aria-hidden className="text-base">
              ✨
            </span>
            {t.nav.startNewSession}
          </Link>
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          <Link
            href="/sessions"
            role="menuitem"
            onClick={close}
            className="flex items-center justify-between px-3.5 py-2.5 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <span>{t.nav.viewPreviousSessions}</span>
            <span aria-hidden className="text-zinc-400">
              →
            </span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
