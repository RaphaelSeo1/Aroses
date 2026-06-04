"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export function ExplorePurchaseNotice() {
  const searchParams = useSearchParams();
  const purchase = searchParams.get("purchase");

  const show = purchase === "success";

  const dismissHref = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.delete("purchase");
    return url.pathname + url.search;
  }, []);

  const dismiss = useCallback(() => {
    window.history.replaceState(null, "", dismissHref || window.location.pathname);
  }, [dismissHref]);

  if (!show) return null;

  return (
    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
      <p className="font-semibold">Purchase complete</p>
      <p className="mt-1">
        Payment received — full lesson access is unlocked.{" "}
        <button
          type="button"
          onClick={dismiss}
          className="underline underline-offset-2"
        >
          Dismiss
        </button>
      </p>
    </div>
  );
}
