"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * `history.scrollRestoration = "manual"` is set in root `layout.tsx` (beforeInteractive)
 * so hard reloads do not stick at the previous scroll position.
 *
 * This component scrolls to the top on **pathname** changes when there is no in-page
 * hash target (so `#section` links still work).
 */
export function ScrollRestoration() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.length > 1) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}
