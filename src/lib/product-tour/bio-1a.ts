/**
 * Identity of the founder-uploaded Bio 1A course used as the onboarding tour
 * sandbox. Wired to the live production row; override with
 * `NEXT_PUBLIC_TOUR_COURSE_ID` when a fork/dev DB uses a different id.
 *
 * Production (aroses.app / shared Supabase):
 *   id:        4b2be649-2da4-4790-a71c-36de0adf704e
 *   title:     Bio 1A
 *   owner:     0a5da40a-2d32-4bb9-9ef0-107d6557a88f
 *   listing:   approved marketplace course (not a free is_public row)
 */

export const BIO_1A_COURSE_ID = "4b2be649-2da4-4790-a71c-36de0adf704e";
export const BIO_1A_OWNER_ID = "0a5da40a-2d32-4bb9-9ef0-107d6557a88f";
export const BIO_1A_TITLE = "Bio 1A";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Env override, else the live Bio 1A id. */
export function configuredTourCourseId(): string {
  const raw = process.env.NEXT_PUBLIC_TOUR_COURSE_ID?.trim() ?? "";
  if (isUuid(raw)) return raw.toLowerCase();
  return BIO_1A_COURSE_ID;
}

export function isConfiguredTourCourseId(courseId: string): boolean {
  return courseId.trim().toLowerCase() === configuredTourCourseId();
}

export function normalizeCourseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Titles like "Bio 1A", "Biology 1A", "Bio 1A — General Biology". */
export function isBio1ATitle(title: string): boolean {
  const n = normalizeCourseTitle(title);
  if (!n) return false;
  if (n === "bio 1a" || n === "biology 1a") return true;
  if (n.startsWith("bio 1a ") || n.startsWith("biology 1a ")) return true;
  if (/^bio(?:logy)?\s*1a\b/.test(n)) return true;
  return n.includes("bio 1a —") || n.includes("bio 1a -");
}

export type TourCourseCandidate = {
  id: string;
  title: string;
  user_id?: string | null;
};

/**
 * Prefer the configured/live Bio 1A id, then founder-owned Bio 1A title,
 * then any Bio 1A title in the catalog. Returns null when nothing matches
 * (local/dev without the uploaded course).
 */
export function pickTourCourseFromList(
  courses: readonly TourCourseCandidate[]
): TourCourseCandidate | null {
  if (courses.length === 0) return null;
  const configured = configuredTourCourseId();
  const byId = courses.find((c) => c.id.toLowerCase() === configured);
  if (byId) return byId;

  const titled = courses.filter((c) => isBio1ATitle(c.title));
  const byOwner = titled.find(
    (c) => (c.user_id ?? "").toLowerCase() === BIO_1A_OWNER_ID
  );
  if (byOwner) return byOwner;
  return titled[0] ?? null;
}

export function isTourDemoCourseId(courseId: string): boolean {
  const id = courseId.trim().toLowerCase();
  if (!isUuid(id)) return false;
  return id === configuredTourCourseId();
}
