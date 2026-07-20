"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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

const PAD = 8;
const TOOLTIP_GAP = 12;

type Rect = { top: number; left: number; width: number; height: number };

function findTourEl(step: ProductTourStep): Element | null {
  const primary = document.querySelector(`[data-tour="${step.target}"]`);
  if (primary) return primary;
  if (step.fallbackTarget) {
    return document.querySelector(`[data-tour="${step.fallbackTarget}"]`);
  }
  return null;
}

function rectFromEl(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function ProductTourInner() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);

  const steps = PRODUCT_TOUR_STEPS;
  const step = steps[clampTourStep(stepIndex)]!;
  const total = steps.length;
  const isLast = stepIndex >= total - 1;

  const copy = useMemo(() => {
    const key = step.copyKey as keyof typeof t.productTour.steps;
    return t.productTour.steps[key];
  }, [step.copyKey, t.productTour.steps]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const startTour = useCallback((startStep = 0) => {
    const next = clampTourStep(startStep);
    setStepIndex(next);
    setActive(true);
    writeTourSession({ active: true, step: next });
  }, []);

  // Boot from ?tour=1 or existing session.
  useEffect(() => {
    if (pathname === "/onboarding" || pathname === "/intro" || pathname === "/login") {
      return;
    }
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
      setStepIndex(clampTourStep(session.step));
      setActive(true);
    }
  }, [pathname, router, searchParams, startTour]);

  const completeTour = useCallback(async () => {
    setBusy(true);
    clearTourSession();
    setActive(false);
    setRect(null);
    try {
      await fetch("/api/product-tour/complete", { method: "POST" });
    } catch {
      /* still dismiss locally */
    } finally {
      setBusy(false);
    }
  }, []);

  const goToStep = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= steps.length) {
        void completeTour();
        return;
      }
      const next = clampTourStep(nextIndex);
      const nextStep = steps[next]!;
      setStepIndex(next);
      writeTourSession({ active: true, step: next });
      if (pathname !== nextStep.route) {
        router.push(nextStep.route);
      }
    },
    [completeTour, pathname, router, steps]
  );

  // Measure / follow target for the current step.
  useLayoutEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const measure = () => {
      if (cancelled) return;
      const el = findTourEl(step);
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        setRect(rectFromEl(el));
        return true;
      }
      setRect(null);
      return false;
    };

    const tick = () => {
      if (cancelled) return;
      const ok = measure();
      attempts += 1;
      if (!ok && attempts < 20) {
        timer = setTimeout(tick, 100);
      }
    };

    // Wait a beat after route changes for the page to paint.
    timer = setTimeout(tick, pathname === step.route ? 40 : 180);

    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        measure();
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [active, step, pathname]);

  // If we're on the wrong route for the active step, navigate there.
  useEffect(() => {
    if (!active) return;
    if (pathname !== step.route) {
      router.push(step.route);
    }
  }, [active, pathname, router, step.route]);

  if (!mounted || !active) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;

  const hole = rect ?? {
    top: vh * 0.28,
    left: Math.max(16, vw / 2 - 160),
    width: Math.min(320, vw - 32),
    height: 120,
  };

  const tooltipWidth = Math.min(340, Math.max(260, vw - 32));
  let tipTop = hole.top + hole.height + TOOLTIP_GAP;
  let tipLeft = Math.min(
    Math.max(16, hole.left + hole.width / 2 - tooltipWidth / 2),
    vw - tooltipWidth - 16
  );
  if (tipTop + 220 > vh) {
    tipTop = Math.max(16, hole.top - TOOLTIP_GAP - 200);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200]"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") void completeTour();
      }}
    >
      {/* Full-screen catcher so the dimmed UI is not clickable mid-tour. */}
      <div className="absolute inset-0" aria-hidden />
      {/* Spotlight cutout (visual only) */}
      <div
        className="pointer-events-none absolute rounded-2xl ring-2 ring-white/90 dark:ring-brand-soft/80"
        style={{
          top: hole.top,
          left: hole.left,
          width: Math.max(hole.width, 0),
          height: Math.max(hole.height, 0),
          boxShadow: "0 0 0 9999px rgba(15, 15, 18, 0.62)",
        }}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-tour-title"
        className="absolute rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/25 dark:border-zinc-700 dark:bg-zinc-950"
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
            onClick={() => goToStep(stepIndex + 1)}
            className="inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {isLast ? t.productTour.finish : t.productTour.next}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void completeTour()}
            className="inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            {t.productTour.skip}
          </button>
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
