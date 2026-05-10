"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  readStoredTheme,
  type ThemePreference,
} from "@/lib/theme";

function IconSun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSystem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="2"
        y="3"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const BTN =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-transparent text-brand-muted hover:bg-brand-blush hover:text-brand-ink dark:text-brand-soft dark:hover:bg-white/10 dark:hover:text-white";

const BTN_ON =
  "border-brand-border bg-white text-brand shadow-sm dark:border-brand-border/50 dark:bg-[#1e1616] dark:text-brand-soft";

export function ThemeToggle() {
  /** Always start `"system"` so server HTML matches the client’s first paint (avoids hydration crashes). */
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = readStoredTheme() ?? "system";
    setPref(stored);
    applyTheme(stored);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      if ((readStoredTheme() ?? "system") === "system") applyTheme("system");
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const pick = useCallback((next: ThemePreference) => {
    setPref(next);
    applyTheme(next);
  }, []);

  return (
    <div
      className="flex items-center rounded-full border border-brand-border bg-brand-blush/60 p-0.5 dark:border-brand-border/40 dark:bg-[#1e1616]/80"
      role="group"
      aria-label="Theme"
    >
      <button
        type="button"
        title="Light"
        className={`${BTN} ${pref === "light" ? BTN_ON : ""}`}
        onClick={() => pick("light")}
      >
        <IconSun className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Match system"
        className={`${BTN} ${pref === "system" ? BTN_ON : ""}`}
        onClick={() => pick("system")}
      >
        <IconSystem className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Dark"
        className={`${BTN} ${pref === "dark" ? BTN_ON : ""}`}
        onClick={() => pick("dark")}
      >
        <IconMoon className="h-4 w-4" />
      </button>
    </div>
  );
}
