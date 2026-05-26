"use client";

import { useEffect, useState } from "react";

/** True when viewport width is at least `px` (matches Tailwind `xl` at 1280). */
export function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(min-width: ${px}px)`).matches;
  });
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return matches;
}
