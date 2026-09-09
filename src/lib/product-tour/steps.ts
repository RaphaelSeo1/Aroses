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

export function buildFallbackProductTourSteps(): ProductTourStep[] {
  return [
    {
      id: "explore-bio-1a",
      route: "/explore",
      target: "explore-heading",
      copyKey: "exploreBio1A",
    },
    {
      id: "notes-hub",
      route: "/notes",
      target: "notes-hub",
      copyKey: "notesHub",
    },
    {
      id: "review",
      route: "/dashboard/review",
      target: "review-dashboard",
      copyKey: "reviewDashboard",
    },
    {
      id: "tutor",
      route: "/dashboard/review",
      target: "nav-tutor",
      fallbackTarget: "nav-menu",
      copyKey: "tutor",
    },
  ];
}

export function buildProductTourSteps(
  courseId: string | null | undefined,
  available = true
): ProductTourStep[] {
  const id = (courseId ?? "").trim();
  if (!available || !id) return buildFallbackProductTourSteps();

  const exploreCourse = `/explore/${id}`;
  const study = `${exploreCourse}/study`;
  const quiz = `${study}/quiz`;

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
      copyKey: "courseOverview",
    },
    {
      id: "course-outline",
      route: exploreCourse,
      target: "explore-course-outline",
      fallbackTarget: "explore-course-title",
      copyKey: "courseModules",
    },
    {
      id: "start-learning",
      route: exploreCourse,
      target: "explore-start-learning",
      fallbackTarget: "explore-course-title",
      copyKey: "startLearning",
    },
    {
      id: "lesson-content",
      route: study,
      search: "mode=learn",
      target: "course-lesson",
      fallbackTarget: "course-modules",
      copyKey: "lessonContent",
    },
    {
      id: "course-notes",
      route: study,
      search: "mode=learn",
      target: "course-notes",
      fallbackTarget: "notes-hub",
      copyKey: "courseNotes",
    },
    {
      id: "notes-hub",
      route: "/notes",
      target: "notes-hub",
      copyKey: "notesHub",
    },
    {
      id: "course-quiz",
      route: quiz,
      target: "course-quiz",
      fallbackTarget: "course-modules",
      copyKey: "courseQuiz",
    },
    {
      id: "review",
      route: "/dashboard/review",
      target: "review-dashboard",
      copyKey: "reviewDashboard",
    },
    {
      id: "tutor",
      route: "/dashboard/review",
      target: "nav-tutor",
      fallbackTarget: "nav-menu",
      copyKey: "tutor",
    },
  ];
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
