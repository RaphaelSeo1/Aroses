"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UI_LOCALE_OPTIONS,
  type UiLocale,
} from "@/lib/i18n/config";
import { useLocale, useSetUiLocale, useT } from "@/lib/i18n/LocaleProvider";

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/**
 * Globe dropdown that switches the app UI language (English / 한국어).
 * Used in page headers and the profile settings page.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const setUiLocale = useSetUiLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const pick = useCallback(
    async (next: UiLocale) => {
      setOpen(false);
      if (next === locale || pending) return;
      setPending(true);
      try {
        await setUiLocale(next);
      } finally {
        setPending(false);
      }
    },
    [locale, pending, setUiLocale]
  );

  const current = UI_LOCALE_OPTIONS.find((o) => o.value === locale);

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.common.language}
        title={t.common.language}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-sm font-medium text-brand-muted transition hover:bg-brand-blush hover:text-brand-ink disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
      >
        <GlobeIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">{current?.label}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
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

      {open ? (
        <div
          role="menu"
          aria-label={t.common.language}
          className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10 ring-1 ring-zinc-900/[0.04] dark:border-zinc-700 dark:bg-zinc-900 dark:ring-white/10"
        >
          {UI_LOCALE_OPTIONS.map((option) => {
            const active = option.value === locale;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => void pick(option.value)}
                className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition ${
                  active
                    ? "font-semibold text-brand dark:text-white"
                    : "font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span>{option.label}</span>
                {active ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact inline EN / 한국어 toggle for tight surfaces (avatar dropdown menu).
 */
export function LanguageToggleRow() {
  const t = useT();
  const locale = useLocale();
  const setUiLocale = useSetUiLocale();
  const [pending, setPending] = useState(false);

  const pick = useCallback(
    async (next: UiLocale) => {
      if (next === locale || pending) return;
      setPending(true);
      try {
        await setUiLocale(next);
      } finally {
        setPending(false);
      }
    },
    [locale, pending, setUiLocale]
  );

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
      <GlobeIcon className="h-4 w-4 shrink-0 opacity-70 text-zinc-800 dark:text-zinc-100" />
      <span className="flex-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {t.common.language}
      </span>
      <div className="inline-flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-700">
        {UI_LOCALE_OPTIONS.map((option) => {
          const active = option.value === locale;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => void pick(option.value)}
              disabled={pending}
              aria-pressed={active}
              className={`px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                active
                  ? "bg-brand text-white"
                  : "bg-transparent text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
