import { isUuid } from "./bio-1a.ts";

/** Client-set cookie so Explore study routes can sandbox Bio 1A during the tour. */
export const TOUR_DEMO_COOKIE = "aroses_tour_demo";

const MAX_AGE_SEC = 60 * 60 * 2;

export function parseTourDemoCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  return isUuid(value) ? value : null;
}

export function tourDemoCookieHeader(courseId: string): string {
  return `${TOUR_DEMO_COOKIE}=${courseId.toLowerCase()}; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax`;
}

export function clearTourDemoCookieHeader(): string {
  return `${TOUR_DEMO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function writeTourDemoCookie(courseId: string | null): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = courseId
      ? tourDemoCookieHeader(courseId)
      : clearTourDemoCookieHeader();
  } catch {
    /* ignore */
  }
}

export function readTourDemoCookieFromDocument(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const parts = document.cookie.split(";");
    for (const part of parts) {
      const [name, ...rest] = part.trim().split("=");
      if (name === TOUR_DEMO_COOKIE) {
        return parseTourDemoCookie(rest.join("="));
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isTourDemoAccessForCourse(
  courseId: string,
  cookieCourseId: string | null
): boolean {
  if (!cookieCourseId) return false;
  return courseId.trim().toLowerCase() === cookieCourseId;
}
