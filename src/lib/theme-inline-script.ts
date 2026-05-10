import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Runs in <head> before paint. Logic mirrors `applyTheme` / `resolveDark`.
 */
export const THEME_INLINE_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);var dark=false;if(t==="dark")dark=true;else if(t==="light")dark=false;else dark=window.matchMedia("(prefers-color-scheme: dark)").matches;if(dark)document.documentElement.classList.add("dark");else document.documentElement.classList.remove("dark");}catch(e){}})();`;
