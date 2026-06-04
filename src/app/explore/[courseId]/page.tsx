import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ExploreCourseOutline } from "@/components/ExploreCourseOutline";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { BuyCourseButton } from "@/components/marketplace/BuyCourseButton";
import { ExplorePurchaseNotice } from "@/components/marketplace/ExplorePurchaseNotice";
import { APP_NAME } from "@/lib/brand";
import { exploreOutlineFromRpcPayload } from "@/lib/explore-course-outline";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import {
  formatPrice,
  resolveExploreCourse,
} from "@/lib/marketplace/listing-access";
import { isMarketplacePaymentsEnabled } from "@/lib/marketplace/platform-fee";
import { hasPurchasedCourse } from "@/lib/marketplace/purchases";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { courseId } = await params;
  if (!UUID_RE.test(courseId)) return { title: `Course — ${APP_NAME}` };

  const supabase = await createClient();
  const resolved = await resolveExploreCourse(supabase, courseId);
  if (!resolved) return { title: `Explore — ${APP_NAME}` };
  return { title: `${resolved.title} — Explore — ${APP_NAME}` };
}

export default async function ExploreCoursePage({ params }: Props) {
  const { courseId } = await params;
  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/explore/${courseId}`)}`);
  }

  const course = await resolveExploreCourse(supabase, courseId);
  if (!course) notFound();

  const { data: outlineRaw, error: outlineError } = await supabase.rpc(
    "explore_course_outline",
    { p_course_id: courseId }
  );
  const outlineGroups = outlineError
    ? []
    : exploreOutlineFromRpcPayload(outlineRaw);

  const isOwner = user.id === course.user_id;
  const isForSale = course.kind === "for_sale";
  const hasPurchased =
    !isOwner && isForSale
      ? await hasPurchasedCourse(supabase, user.id, courseId)
      : false;
  const canStudy = isOwner || !isForSale || hasPurchased;
  const paymentsEnabled = isMarketplacePaymentsEnabled();
  const studyHref = `/explore/${courseId}/learn`;

  const { data: sellerProfile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", course.user_id)
    .maybeSingle();

  const sellerLabel =
    sellerProfile?.username != null
      ? `@${sellerProfile.username}`
      : sellerProfile?.display_name ?? "Creator";

  const adminHubHref = adminHubHrefForSessionUser(user);

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedInServer adminHubHref={adminHubHref} />
          ) : (
            <>
              <HeaderNavLink href="/explore">Explore</HeaderNavLink>
              <HeaderNavLink href="/login">Log in</HeaderNavLink>
              <HeaderNavLink href="/signup" variant="primary">
                Sign up
              </HeaderNavLink>
            </>
          )
        }
      />
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
          <Link
            href="/explore"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand transition hover:gap-2 dark:text-brand-soft"
          >
            <span aria-hidden>←</span> All listings
          </Link>

          <div className="relative mt-8 overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/80 p-6 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/70 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/75 dark:shadow-black/25 dark:ring-zinc-600/40 sm:p-8">
            <div className="relative">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                {isForSale ? "Course for sale" : "Community course"}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
                {course.title}
              </h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/90 bg-zinc-50/90 px-2.5 py-0.5 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
                  {sellerLabel}
                </span>
                {isForSale ? (
                  <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                    {formatPrice(course.price_cents, course.currency)}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-600/90 px-2.5 py-0.5 font-bold text-white">
                    Free
                  </span>
                )}
              </p>
              {course.description ? (
                <p className="mt-6 whitespace-pre-wrap border-t border-zinc-100 pt-6 text-base leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  {course.description}
                </p>
              ) : (
                <p className="mt-6 border-t border-zinc-100 pt-6 text-sm italic text-zinc-500 dark:border-zinc-800">
                  No description provided.
                </p>
              )}
            </div>
          </div>

          <Suspense fallback={null}>
            <ExplorePurchaseNotice />
          </Suspense>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            {isForSale && !canStudy ? (
              <BuyCourseButton
                courseId={courseId}
                priceLabel={formatPrice(course.price_cents, course.currency)}
                paymentsEnabled={paymentsEnabled}
              />
            ) : (
              <>
                <Link
                  href={studyHref}
                  className="inline-flex w-full items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/25 transition hover:bg-brand-hover sm:w-auto dark:bg-brand dark:hover:bg-brand-soft"
                >
                  {isOwner ? "Open as creator" : "Start learning"}
                </Link>
                <p className="max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {isOwner
                    ? "You own this course — full access from your dashboard or here."
                    : hasPurchased
                      ? "You purchased this course — full lesson access is unlocked."
                      : "Opens Mentored Learning with full lesson access."}
                </p>
              </>
            )}
          </div>

          {outlineError ? (
            <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Course outline requires migration{" "}
              <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                009_explore_course_outline.sql
              </code>
              .
            </p>
          ) : null}
        </div>

        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <ExploreCourseOutline groups={outlineGroups} />
        </div>

        <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-6 sm:pb-14">
          {isOwner ? (
            <p className="mt-10 rounded-xl border border-brand-border bg-brand-blush/80 px-4 py-3 text-sm text-brand-ink dark:border-brand-border/40 dark:bg-brand-blush/8 dark:text-brand-blush">
              This is your listing. Manage it from your course dashboard.
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
