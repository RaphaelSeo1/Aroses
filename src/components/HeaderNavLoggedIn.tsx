import Link from "next/link";
import {
  HEADER_NAV_ACCENT,
  HEADER_NAV_NEUTRAL,
} from "@/components/AppHeader";
import { LogoutButton } from "@/components/LogoutButton";

/**
 * Same primary navigation on every authenticated screen so items never “disappear”
 * when switching routes (e.g. Explore vs dashboard).
 */
export function HeaderNavLoggedIn({
  courseHomeHref,
}: {
  /** Show when studying — links back to uploads/workspace for this course. */
  courseHomeHref?: string;
}) {
  return (
    <>
      <Link href="/explore" className={HEADER_NAV_ACCENT}>
        Explore
      </Link>
      <Link href="/dashboard/progress" className={HEADER_NAV_NEUTRAL}>
        Progress
      </Link>
      <Link href="/dashboard" className={HEADER_NAV_NEUTRAL}>
        My courses
      </Link>
      {courseHomeHref ? (
        <Link href={courseHomeHref} className={HEADER_NAV_NEUTRAL}>
          Course home
        </Link>
      ) : null}
      <LogoutButton />
    </>
  );
}
