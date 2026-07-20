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

const CELEBRATE_FLAG = "aroses_product_tour_celebrate";

const PAD = 10;
const TOOLTIP_GAP = 14;
const TOOLTIP_EST_HEIGHT = 230;

type Rect = { top: number; left: number; width: number; height: number };

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
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const bootedRef = useRef(false);
  const scrolledForStepRef = useRef<string | null>(null);
  const confettiFiredRef = useRef(false);

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
    setCelebrating(false);
  }, []);

  const completeTour = useCallback(async (opts?: { celebrate?: boolean }) => {
    setBusy(true);
    clearTourSession();
    setActive(false);
    setRect(null);
    scrolledForStepRef.current = null;
    if (opts?.celebrate) {
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
      <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-[2px]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-tour-celebration-title"
          className="w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-7 text-center shadow-2xl shadow-zinc-950/30 dark:border-zinc-700 dark:bg-zinc-950"
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
          <button
            type="button"
            onClick={dismissCelebration}
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            {t.productTour.celebrationCta}
          </button>
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
              onClick={() => void completeTour({ celebrate: false })}
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
