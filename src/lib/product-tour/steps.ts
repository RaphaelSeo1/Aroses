/**
 * Multi-page product tour step definitions.
 * Copy lives in `src/locales/productTour.ts` keyed by `copyKey`.
 */
import { configuredTourCourseId } from "./bio-1a.ts";

export type ProductTourStep = {
  id: string;
  /** App pathname where the target should be visible. */
  route: string;
  /** Optional query string without `?` (e.g. `mode=learn`). */
  search?: string;
  /** `data-tour` attribute value on the spotlight target. */
  target: string;
  /** Optional fallback when primary target is missing (e.g. mobile). */
  fallbackTarget?: string;
  /** Key under `t.productTour.steps`. */
  copyKey: string;
};

export const PRODUCT_TOUR_STORAGE_KEY = "aroses_product_tour";

export function hrefForTourStep(step: ProductTourStep): string {
  return step.search ? `${step.route}?${step.search}` : step.route;
}

export function stepRouteMatches(pathname: string, step: ProductTourStep): boolean {
  return pathname === step.route;
}

function siteTourSteps(): ProductTourStep[] {
  return [
    {
      id: "welcome",
      route: "/",
      target: "home-start",
      copyKey: "welcome",
    },
    {
      id: "create-course",
      route: "/",
      target: "home-create-course",
      copyKey: "createCourse",
    },
    {
      id: "course-modes",
      route: "/dashboard/courses/new",
      target: "course-mode-chooser",
      copyKey: "courseModes",
    },
    {
      id: "library-courses",
      route: "/",
      target: "home-courses",
      copyKey: "libraryCourses",
    },
    {
      id: "notes-tile",
      route: "/",
      target: "home-notes",
      copyKey: "notesTile",
    },
    {
      id: "notes-hub",
      route: "/notes",
      target: "notes-hub",
      copyKey: "notesHub",
    },
    {
      id: "explore",
      route: "/explore",
      target: "explore-heading",
      copyKey: "explore",
    },
  ];
}

function shortBio1ASteps(courseId: string): ProductTourStep[] {
  const exploreCourse = `/explore/${courseId}`;
  return [
    {
      id: "explore-bio-1a",
      route: "/explore",
      target: "explore-bio-1a",
      fallbackTarget: "explore-heading",
      copyKey: "exploreBio1A",
    },
    {
      id: "course-overview",
      route: exploreCourse,
      target: "explore-course-title",
      fallbackTarget: "explore-start-learning",
      copyKey: "courseOverview",
    },
  ];
}

function closingTourSteps(): ProductTourStep[] {
  return [
    {
      id: "tutor",
      route: "/explore",
      target: "nav-tutor",
      fallbackTarget: "nav-menu",
      copyKey: "tutor",
    },
    {
      id: "account",
      route: "/explore",
      target: "nav-account",
      copyKey: "account",
    },
  ];
}

export function buildFallbackProductTourSteps(): ProductTourStep[] {
  return [...siteTourSteps(), ...closingTourSteps()];
}

/**
 * Original site walkthrough, then a short Bio 1A dip once Explore is reached.
 */
export function buildProductTourSteps(
  courseId: string | null | undefined,
  available = true
): ProductTourStep[] {
  const id = (courseId ?? "").trim();
  if (!available || !id) return buildFallbackProductTourSteps();
  return [...siteTourSteps(), ...shortBio1ASteps(id), ...closingTourSteps()];
}

/** Default steps aimed at the live Bio 1A course id (may 404 in empty local DBs). */
export const PRODUCT_TOUR_STEPS: readonly ProductTourStep[] =
  buildProductTourSteps(configuredTourCourseId());

export type ProductTourSession = {
  active: boolean;
  step: number;
  courseId?: string | null;
};

export function readTourSession(): ProductTourSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PRODUCT_TOUR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProductTourSession;
    if (
      typeof parsed?.active !== "boolean" ||
      typeof parsed?.step !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeTourSession(session: ProductTourSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PRODUCT_TOUR_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearTourSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PRODUCT_TOUR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clampTourStep(step: number, length = PRODUCT_TOUR_STEPS.length): number {
  if (!Number.isFinite(step) || step < 0) return 0;
  if (step >= length) return Math.max(0, length - 1);
  return Math.floor(step);
}
