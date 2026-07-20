/**
 * Multi-page product tour step definitions.
 * Copy lives in `src/locales/productTour.ts` keyed by `copyKey`.
 */
export type ProductTourStep = {
  id: string;
  /** App pathname where the target should be visible. */
  route: string;
  /** `data-tour` attribute value on the spotlight target. */
  target: string;
  /** Optional fallback when primary target is missing (e.g. mobile). */
  fallbackTarget?: string;
  /** Key under `t.productTour.steps`. */
  copyKey: string;
};

export const PRODUCT_TOUR_STORAGE_KEY = "aroses_product_tour";

export const PRODUCT_TOUR_STEPS: readonly ProductTourStep[] = [
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
] as const;

export type ProductTourSession = {
  active: boolean;
  step: number;
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

export function clampTourStep(step: number): number {
  if (!Number.isFinite(step) || step < 0) return 0;
  if (step >= PRODUCT_TOUR_STEPS.length) return PRODUCT_TOUR_STEPS.length - 1;
  return Math.floor(step);
}
