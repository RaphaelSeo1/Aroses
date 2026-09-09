"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import {
  hasPaidProductAccess,
  PAID_PLAN_REQUIRED_CODE,
  requestUpgradePopup,
  unpaidUserShouldBlockFeaturePath,
  UPGRADE_POPUP_PATH,
} from "@/lib/billing/paid-access";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { readTourSession } from "@/lib/product-tour/steps";
import { createClient } from "@/lib/supabase/client";

function tourIsRunning(): boolean {
  return readTourSession()?.active === true;
}

function hrefFromClick(event: MouseEvent): { pathname: string; search: string } | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.closest("[data-upgrade-modal]")) return null;
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return { pathname: url.pathname, search: url.search.replace(/^\?/, "") };
  } catch {
    return null;
  }
}

/**
 * Unpaid users may browse hubs. Feature links, paid-gated buttons, and 402
 * mutation responses reopen the upgrade popup instead of sending them to billing.
 */
function PaidFeatureGateInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    if (!isBillingUiEnabled()) return;
    let cancelled = false;

    void (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        if (isAppAdminEnvUser(user)) {
          lockedRef.current = false;
          setLocked(false);
          return;
        }
        const { data } = await supabase
          .from("user_subscriptions")
          .select("tier, status, admin_granted")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        const nextLocked = !hasPaidProductAccess({
          tier: data?.tier,
          status: data?.status,
          adminGranted: Boolean(
            (data as { admin_granted?: boolean } | null)?.admin_granted
          ),
        });
        lockedRef.current = nextLocked;
        setLocked(nextLocked);
      } catch {
        /* leave unlocked on lookup failure so a blip doesn't brick the UI */
      }
    })();

    const onClick = (event: MouseEvent) => {
      if (!lockedRef.current || tourIsRunning()) return;
      const el = event.target;
      if (el instanceof Element && el.closest("[data-upgrade-modal]")) return;

      if (el instanceof Element && el.closest("[data-requires-paid]")) {
        event.preventDefault();
        event.stopPropagation();
        requestUpgradePopup();
        return;
      }

      const href = hrefFromClick(event);
      if (!href) return;
      if (unpaidUserShouldBlockFeaturePath(href.pathname, href.search)) {
        event.preventDefault();
        event.stopPropagation();
        requestUpgradePopup();
      }
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (lockedRef.current && !tourIsRunning() && res.status === 402) {
        try {
          const body = (await res.clone().json()) as { code?: string };
          if (
            body.code === PAID_PLAN_REQUIRED_CODE ||
            body.code === "course_cap_reached" ||
            body.code === "lecture_recording_cap_reached"
          ) {
            requestUpgradePopup();
          }
        } catch {
          requestUpgradePopup();
        }
      }
      return res;
    };

    document.addEventListener("click", onClick, true);
    return () => {
      cancelled = true;
      document.removeEventListener("click", onClick, true);
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (!locked || tourIsRunning()) return;
    const search = searchParams.toString();
    if (!unpaidUserShouldBlockFeaturePath(pathname, search)) return;
    requestUpgradePopup();
    router.replace(UPGRADE_POPUP_PATH);
  }, [locked, pathname, router, searchParams]);

  return null;
}

export function PaidFeatureGate() {
  return (
    <Suspense fallback={null}>
      <PaidFeatureGateInner />
    </Suspense>
  );
}
