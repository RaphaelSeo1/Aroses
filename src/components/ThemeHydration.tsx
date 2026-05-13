"use client";

import { useEffect } from "react";
import { syncThemeAfterMount } from "@/lib/theme";

/**
 * Re-applies `localStorage` / system theme after React hydrates `<html>` (SSR className
 * overwrites the `beforeInteractive` inline script’s `dark` class). Required on routes
 * that do not mount `ThemeToggle` (e.g. `/dashboard/admin`).
 */
export function ThemeHydration() {
  useEffect(() => {
    return syncThemeAfterMount();
  }, []);

  return null;
}
