"use client";

import { BrandLogo } from "@/components/BrandLogo";

type OrbPos = { top: number; left: number };

export function TourGuideOrb({ hole }: { hole: OrbPos | null }) {
  const top = hole ? Math.max(12, hole.top - 18) : 96;
  const left = hole ? Math.max(12, hole.left - 18) : 24;

  return (
    <div
      className="pointer-events-none absolute z-20 h-14 w-14"
      style={{
        top,
        left,
        transition:
          "top 420ms cubic-bezier(0.22, 1, 0.36, 1), left 420ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-hidden
    >
      <span className="tour-guide-orb-ring absolute inset-0 rounded-full" />
      <span className="tour-guide-orb-ring tour-guide-orb-ring-delay absolute inset-0 rounded-full" />
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_8px_24px_rgba(225,29,72,0.28)] ring-2 ring-white">
        <BrandLogo className="h-14 w-14 rounded-full ring-0" />
      </span>
    </div>
  );
}
