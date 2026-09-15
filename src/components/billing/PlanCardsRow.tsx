import type { ReactNode } from "react";

/**
 * Shared checkout-plan grid: always five columns in one row.
 * Scrolls horizontally below ~52rem instead of wrapping 3+2.
 */
export function PlanCardsRow({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pt-3">
      <div className="grid min-w-[52rem] grid-cols-5 items-stretch gap-2.5 sm:gap-3">
        {children}
      </div>
    </div>
  );
}
