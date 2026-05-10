export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "aroses-theme";

export function readStoredTheme(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function resolveDark(pref: ThemePreference): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Updates `document.documentElement` class and localStorage. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const dark = resolveDark(pref);

  const commit = () => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      /* ignore */
    }
  };

  const willChange =
    document.documentElement.classList.contains("dark") !== dark;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (
    willChange &&
    !reduceMotion &&
    typeof document.startViewTransition === "function"
  ) {
    document.startViewTransition(commit);
    return;
  }

  commit();
}
