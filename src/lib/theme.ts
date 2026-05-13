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

/**
 * Run once on the client after mount. Next hydration resets `<html class>` to the server
 * tree (no `dark`), wiping the inline script — pages without `ThemeToggle` would stay light.
 * Returns cleanup for the system `prefers-color-scheme` listener when stored pref is `system`.
 */
export function syncThemeAfterMount(): () => void {
  if (typeof window === "undefined") return () => {};

  applyTheme(readStoredTheme() ?? "system");

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onOsThemeChange = () => {
    if ((readStoredTheme() ?? "system") === "system") {
      applyTheme("system");
    }
  };
  mq.addEventListener("change", onOsThemeChange);
  return () => mq.removeEventListener("change", onOsThemeChange);
}
