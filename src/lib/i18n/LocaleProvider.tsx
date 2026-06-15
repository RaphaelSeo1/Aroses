"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/config";
import type { Dictionary } from "@/locales";

type LocaleContextValue = {
  locale: UiLocale;
  dict: Dictionary;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Mounted once in the root layout with the server-resolved locale + dictionary. */
export function LocaleProvider({
  locale,
  dict,
  children,
}: LocaleContextValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, dict }), [locale, dict]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): UiLocale {
  return useContext(LocaleContext)?.locale ?? DEFAULT_UI_LOCALE;
}

/** Translation dictionary for client components: `const t = useT(); t.nav.home`. */
export function useT(): Dictionary {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useT() must be used inside <LocaleProvider>");
  }
  return ctx.dict;
}

/**
 * Returns a function that switches the UI language: persists it (cookie +
 * profile) and re-renders the current route in the new language.
 */
export function useSetUiLocale(): (locale: UiLocale) => Promise<void> {
  const router = useRouter();
  return useCallback(
    async (locale: UiLocale) => {
      try {
        await fetch("/api/ui-locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale }),
        });
      } finally {
        router.refresh();
      }
    },
    [router]
  );
}
