"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import {
  PLAN_ORDER,
  PLANS,
  isPaidTier,
  type PlanTier,
} from "@/lib/billing/plans";
import {
  compareAtPriceMonthly,
  salePercentForTier,
  salePriceMonthly,
} from "@/lib/billing/sale";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import {
  clearTourSession,
  clampTourStep,
  PRODUCT_TOUR_STEPS,
  readTourSession,
  writeTourSession,
  type ProductTourStep,
} from "@/lib/product-tour/steps";
import { createClient } from "@/lib/supabase/client";

const CELEBRATE_FLAG = "aroses_product_tour_celebrate";

const PAD = 10;
const TOOLTIP_GAP = 14;
const TOOLTIP_EST_HEIGHT = 230;

type Rect = { top: number; left: number; width: number; height: number };

function celebrationPlanCopy(
  billing: {
    planFree: string;
    planStudent: string;
    planAdvanced: string;
    planPremium: string;
    planFreeTag: string;
    planStudentTag: string;
    planAdvancedTag: string;
    planPremiumTag: string;
    planFreeHighlight1: string;
    planFreeHighlight2: string;
    planFreeHighlight3: string;
    planStudentHighlight1: string;
    planStudentHighlight2: string;
    planStudentHighlight3: string;
    planAdvancedHighlight1: string;
    planAdvancedHighlight2: string;
    planAdvancedHighlight3: string;
    planPremiumHighlight1: string;
    planPremiumHighlight2: string;
    planPremiumHighlight3: string;
  },
  tier: PlanTier
) {
  if (tier === "free") {
    return {
      name: billing.planFree,
      tagline: billing.planFreeTag,
      highlights: [
        billing.planFreeHighlight1,
        billing.planFreeHighlight2,
        billing.planFreeHighlight3,
      ],
    };
  }
  if (tier === "student") {
    return {
      name: billing.planStudent,
      tagline: billing.planStudentTag,
      highlights: [
        billing.planStudentHighlight1,
        billing.planStudentHighlight2,
        billing.planStudentHighlight3,
      ],
    };
  }
  if (tier === "advanced") {
    return {
      name: billing.planAdvanced,
      tagline: billing.planAdvancedTag,
      highlights: [
        billing.planAdvancedHighlight1,
        billing.planAdvancedHighlight2,
        billing.planAdvancedHighlight3,
      ],
    };
  }
  return {
    name: billing.planPremium,
    tagline: billing.planPremiumTag,
    highlights: [
      billing.planPremiumHighlight1,
      billing.planPremiumHighlight2,
      billing.planPremiumHighlight3,
    ],
  };
}

function readCelebrateFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(CELEBRATE_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeCelebrateFlag(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) sessionStorage.setItem(CELEBRATE_FLAG, "1");
    else sessionStorage.removeItem(CELEBRATE_FLAG);
  } catch {
    /* ignore */
  }
}

async function fireTourConfetti() {
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    const colors = ["#e11d48", "#fb7185", "#fda4af", "#fbbf24", "#34d399"];
    const base = {
      colors,
      zIndex: 10000,
      disableForReducedMotion: true as const,
    };
    confetti({
      ...base,
      particleCount: 110,
      spread: 80,
      startVelocity: 38,
      origin: { y: 0.62 },
    });
    window.setTimeout(() => {
      confetti({
        ...base,
        particleCount: 60,
        angle: 60,
        spread: 60,
        origin: { x: 0, y: 0.7 },
      });
      confetti({
        ...base,
        particleCount: 60,
        angle: 120,
        spread: 60,
        origin: { x: 1, y: 0.7 },
      });
    }, 200);
  } catch {
    /* confetti is optional — popup still shows */
  }
}

function findTourEl(step: ProductTourStep): HTMLElement | null {
  const primary = document.querySelector(
    `[data-tour="${step.target}"]`
  ) as HTMLElement | null;
  if (primary && isVisible(primary)) return primary;
  if (step.fallbackTarget) {
    const fallback = document.querySelector(
      `[data-tour="${step.fallbackTarget}"]`
    ) as HTMLElement | null;
    if (fallback && isVisible(fallback)) return fallback;
  }
  if (step.fallbackTarget) {
    const fallback = document.querySelector(
      `[data-tour="${step.fallbackTarget}"]`
    ) as HTMLElement | null;
    if (fallback) return fallback;
  }
  return primary;
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function rectFromEl(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.max(8, r.top - PAD);
  const left = Math.max(8, r.left - PAD);
  const right = Math.min(vw - 8, r.right + PAD);
  const bottom = Math.min(vh - 8, r.bottom + PAD);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function ProductTourInner() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showUpgradeOffer, setShowUpgradeOffer] = useState(false);
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const bootedRef = useRef(false);
  const scrolledForStepRef = useRef<string | null>(null);
  const confettiFiredRef = useRef(false);
  const forceUpgradePreviewRef = useRef(false);
  const billingEnabled = isBillingUiEnabled();

  const steps = PRODUCT_TOUR_STEPS;
  const step = steps[clampTourStep(stepIndex)]!;
  const total = steps.length;
  const isLast = stepIndex >= total - 1;
  const onCorrectRoute = pathname === step.route;

  const copy = useMemo(() => {
    const key = step.copyKey as keyof typeof t.productTour.steps;
    return t.productTour.steps[key];
  }, [step.copyKey, t.productTour.steps]);

  useEffect(() => {
    setMounted(true);
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    if (readCelebrateFlag()) {
      setCelebrating(true);
    }
  }, []);

  useEffect(() => {
    if (!celebrating || confettiFiredRef.current) return;
    confettiFiredRef.current = true;
    void fireTourConfetti();
  }, [celebrating]);

  // After setup, show the upgrade card immediately when billing is on, then
  // hide it only once we confirm the user is already on a paid plan.
  // `?setupUpgrade=1` keeps it visible for preview even if subscribed.
  useEffect(() => {
    if (!celebrating || !billingEnabled) {
      if (!forceUpgradePreviewRef.current) setShowUpgradeOffer(false);
      return;
    }
    setShowUpgradeOffer(true);
    if (forceUpgradePreviewRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from("user_subscriptions")
          .select("tier, status")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled || forceUpgradePreviewRef.current) return;
        const tier = (data?.tier as string | undefined) ?? "free";
        const status = (data?.status as string | undefined) ?? "inactive";
        const paid =
          tier !== "free" &&
          (status === "active" || status === "trialing" || status === "past_due");
        if (paid) setShowUpgradeOffer(false);
      } catch {
        /* keep offer visible */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [billingEnabled, celebrating]);

  const startTour = useCallback((startStep = 0) => {
    const next = clampTourStep(startStep);
    scrolledForStepRef.current = null;
    writeCelebrateFlag(false);
    confettiFiredRef.current = false;
    setCelebrating(false);
    setStepIndex(next);
    setActive(true);
    writeTourSession({ active: true, step: next });
  }, []);

  // Preview: `?setupUpgrade=1` can re-fire anytime (even after boot).
  useEffect(() => {
    if (searchParams.get("setupUpgrade") !== "1") return;
    if (
      pathname === "/onboarding" ||
      pathname === "/intro" ||
      pathname === "/login"
    ) {
      return;
    }
    forceUpgradePreviewRef.current = true;
    writeCelebrateFlag(true);
    confettiFiredRef.current = false;
    setCelebrating(true);
    setShowUpgradeOffer(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("setupUpgrade");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // Boot once from ?tour=1 or an in-progress session.
  useEffect(() => {
    if (bootedRef.current) return;
    if (
      pathname === "/onboarding" ||
      pathname === "/intro" ||
      pathname === "/login"
    ) {
      return;
    }
    bootedRef.current = true;

    const wantsTour = searchParams.get("tour") === "1";
    if (wantsTour) {
      startTour(0);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tour");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return;
    }

    const session = readTourSession();
    if (session?.active) {
      scrolledForStepRef.current = null;
      setStepIndex(clampTourStep(session.step));
      setActive(true);
    }
  }, [pathname, router, searchParams, startTour]);

  const dismissCelebration = useCallback(() => {
    writeCelebrateFlag(false);
    confettiFiredRef.current = false;
    forceUpgradePreviewRef.current = false;
    setCelebrating(false);
    setShowUpgradeOffer(false);
    setBusyTier(null);
    setCheckoutError(null);
  }, []);

  const startCheckout = useCallback(
    async (tier: PlanTier) => {
      if (!isPaidTier(tier) || busyTier) return;
      setCheckoutError(null);
      setBusyTier(tier);
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };
        if (!res.ok || !data.url) {
          throw new Error(data.error ?? t.productTour.upgradeCheckoutError);
        }
        writeCelebrateFlag(false);
        window.location.href = data.url;
      } catch (err) {
        setCheckoutError(
          err instanceof Error
            ? err.message
            : t.productTour.upgradeCheckoutError
        );
        setBusyTier(null);
      }
    },
    [busyTier, t.productTour.upgradeCheckoutError]
  );

  const completeTour = useCallback(async (opts?: { celebrate?: boolean }) => {
    setBusy(true);
    clearTourSession();
    setActive(false);
    setRect(null);
    scrolledForStepRef.current = null;
    // Finish + Skip both celebrate so the upgrade offer isn't buried; Escape
    // can pass celebrate:false for a quiet dismiss.
    if (opts?.celebrate !== false) {
      writeCelebrateFlag(true);
      confettiFiredRef.current = false;
      setCelebrating(true);
    } else {
      writeCelebrateFlag(false);
      setCelebrating(false);
    }
    try {
      await fetch("/api/product-tour/complete", { method: "POST" });
    } catch {
      /* still dismiss locally */
    } finally {
      setBusy(false);
    }
  }, []);

  const finishTour = useCallback(() => {
    void completeTour({ celebrate: true });
  }, [completeTour]);

  const goToStep = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= steps.length) {
        finishTour();
        return;
      }
      const next = clampTourStep(nextIndex);
      const nextStep = steps[next]!;
      scrolledForStepRef.current = null;
      setRect(null);
      setStepIndex(next);
      writeTourSession({ active: true, step: next });
      if (pathname !== nextStep.route) {
        router.push(nextStep.route);
      }
    },
    [finishTour, pathname, router, steps]
  );

  // Navigate when the active step lives on another route.
  useEffect(() => {
    if (!active) return;
    if (pathname !== step.route) {
      router.push(step.route);
    }
  }, [active, pathname, router, step.route]);

  useEffect(() => {
    if (!active && !celebrating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (celebrating) {
        dismissCelebration();
        return;
      }
      void completeTour({ celebrate: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, celebrating, completeTour, dismissCelebration]);

  // Measure the spotlight target — scroll once per step (instant), then track rect.
  useLayoutEffect(() => {
    if (!active || !onCorrectRoute) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let raf = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const measureOnly = () => {
      if (cancelled) return false;
      const el = findTourEl(step);
      if (!el) {
        setRect(null);
        return false;
      }
      setRect(rectFromEl(el));
      return true;
    };

    const ensureInViewThenMeasure = () => {
      if (cancelled) return;
      const el = findTourEl(step);
      if (!el) {
        setRect(null);
        attempts += 1;
        if (attempts < 30) {
          retryTimer = setTimeout(ensureInViewThenMeasure, 50);
        }
        return;
      }

      const stepKey = `${step.id}:${step.route}`;
      if (scrolledForStepRef.current !== stepKey) {
        scrolledForStepRef.current = stepKey;
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => {
            if (!cancelled) measureOnly();
          });
        });
        return;
      }

      measureOnly();
    };

    ensureInViewThenMeasure();

    const onViewportChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setVw(window.innerWidth);
        setVh(window.innerHeight);
        measureOnly();
      });
    };

    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, { capture: true, passive: true });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [active, onCorrectRoute, step]);

  if (!mounted) return null;

  if (celebrating) {
    return createPortal(
      <div className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto bg-zinc-950/55 p-4 backdrop-blur-[2px]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-tour-celebration-title"
          className="my-6 w-full max-w-4xl rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-2xl shadow-zinc-950/30 dark:border-zinc-700 dark:bg-zinc-950 sm:p-8"
        >
          <span
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-blush text-brand ring-1 ring-brand/20 dark:bg-brand/20 dark:text-brand-soft"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h2
            id="product-tour-celebration-title"
            className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            {t.productTour.celebrationTitle}
          </h2>
          <p className="mt-3 text-base font-semibold leading-snug text-brand dark:text-brand-soft">
            {t.productTour.celebrationTagline}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t.productTour.celebrationBody}
          </p>

          {showUpgradeOffer ? (
            <div className="mt-6 text-left">
              <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t.productTour.plansHeading}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {PLAN_ORDER.map((tier) => {
                  const plan = PLANS[tier];
                  const price = plan.priceMonthly;
                  const wasPrice = compareAtPriceMonthly(tier);
                  const showSale =
                    isPaidTier(tier) &&
                    price > 0 &&
                    wasPrice != null &&
                    wasPrice > price;
                  const salePrice = showSale ? salePriceMonthly(tier) : price;
                  const salePercent = showSale ? salePercentForTier(tier) : 0;
                  const isBest = tier === "advanced";
                  const copy = celebrationPlanCopy(t.billing, tier);
                  const { name, tagline, highlights } = copy;
                  return (
                    <div
                      key={tier}
                      className={`relative flex flex-col rounded-2xl border p-4 ${
                        isBest
                          ? "plan-card-best"
                          : "border-zinc-200/90 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50"
                      }`}
                    >
                      {isBest ? (
                        <span className="plan-best-badge absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em]">
                          {t.productTour.upgradeBest}
                        </span>
                      ) : null}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                          {name}
                        </h3>
                        {showSale ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {tf(t.billing.saleBadge, {
                              percent: String(salePercent),
                            })}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                        {tagline}
                      </p>
                      <p className="mt-2">
                        {showSale ? (
                          <>
                            <span className="mr-1 text-sm font-medium text-zinc-400 line-through dark:text-zinc-500">
                              ${wasPrice}
                            </span>
                            <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                              ${salePrice}
                            </span>
                          </>
                        ) : (
                          <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                            ${price}
                          </span>
                        )}
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {" "}
                          {t.billing.perMonthLabel}
                        </span>
                      </p>
                      <ul className="mt-3 flex-1 space-y-1.5 text-xs leading-snug text-zinc-600 dark:text-zinc-300">
                        {highlights.map((h) => (
                          <li key={h} className="flex items-start gap-1.5">
                            <span
                              className="mt-0.5 text-brand dark:text-brand-soft"
                              aria-hidden
                            >
                              ✓
                            </span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                      {isPaidTier(tier) ? (
                        <button
                          type="button"
                          disabled={busyTier != null}
                          onClick={() => void startCheckout(tier)}
                          className={`mt-4 inline-flex w-full items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                            isBest
                              ? "bg-violet-600 text-white hover:bg-violet-700"
                              : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                          }`}
                        >
                          {busyTier === tier
                            ? t.productTour.choosePlanBusy
                            : tf(t.productTour.choosePlan, { name })}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={dismissCelebration}
                          className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                        >
                          {t.productTour.celebrationCta}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {checkoutError ? (
                <p
                  className="mt-3 text-center text-xs font-medium text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {checkoutError}
                </p>
              ) : null}
            </div>
          ) : null}

          {!showUpgradeOffer ? (
            <button
              type="button"
              onClick={dismissCelebration}
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              {t.productTour.celebrationCta}
            </button>
          ) : null}
        </div>
      </div>,
      document.body
    );
  }

  if (!active) return null;

  const hole = rect;
  const tooltipWidth = Math.min(340, Math.max(260, (vw || 360) - 32));

  let tipTop = 96;
  let tipLeft = 16;
  if (hole) {
    tipTop = hole.top + hole.height + TOOLTIP_GAP;
    tipLeft = Math.min(
      Math.max(16, hole.left + hole.width / 2 - tooltipWidth / 2),
      (vw || 360) - tooltipWidth - 16
    );
    if (tipTop + TOOLTIP_EST_HEIGHT > (vh || 800)) {
      tipTop = Math.max(16, hole.top - TOOLTIP_GAP - TOOLTIP_EST_HEIGHT);
    }
  } else {
    tipTop = Math.max(96, ((vh || 800) - TOOLTIP_EST_HEIGHT) / 2);
    tipLeft = Math.max(16, ((vw || 360) - tooltipWidth) / 2);
  }

  return createPortal(
    <div className="fixed inset-0 z-[200]" aria-live="polite">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <mask id="aroses-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole ? (
              <rect
                x={hole.left}
                y={hole.top}
                width={hole.width}
                height={hole.height}
                rx="16"
                ry="16"
                fill="black"
              />
            ) : null}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(15, 15, 18, 0.64)"
          mask="url(#aroses-tour-mask)"
        />
      </svg>

      <div className="absolute inset-0" aria-hidden />

      {hole ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)] dark:ring-brand-soft"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          aria-hidden
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-tour-title"
        className="absolute z-10 rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/25 dark:border-zinc-700 dark:bg-zinc-950"
        style={{
          top: tipTop,
          left: tipLeft,
          width: tooltipWidth,
        }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
          {tf(t.productTour.stepOf, {
            current: stepIndex + 1,
            total,
          })}
        </p>
        <h2
          id="product-tour-title"
          className="mt-1.5 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          {copy.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {copy.body}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (isLast) finishTour();
              else goToStep(stepIndex + 1);
            }}
            className="inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {isLast ? t.productTour.finish : t.productTour.next}
          </button>
          {!isLast ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void completeTour({ celebrate: true })}
              className="inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              {t.productTour.skip}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Root-mounted product tour host (Suspense for useSearchParams). */
export function ProductTourHost() {
  return (
    <Suspense fallback={null}>
      <ProductTourInner />
    </Suspense>
  );
}
