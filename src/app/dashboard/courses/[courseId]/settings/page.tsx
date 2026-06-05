import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CourseListingPanel } from "@/components/CourseListingPanel";
import { CourseVisibilityToggle } from "@/components/CourseVisibilityToggle";
import { EditableCourseTitle } from "@/components/EditableCourseTitle";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { SellerConnectPanel } from "@/components/marketplace/SellerConnectPanel";
import {
  fetchCoursePublishingPanels,
  publishingStatusLabel,
} from "@/lib/marketplace/course-publishing-data";
import {
  fetchSellerPayoutAccount,
  refreshConnectAccountFromStripe,
} from "@/lib/marketplace/connect";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ connect?: string }>;
};

export const metadata = {
  title: "Course settings",
};

export default async function CourseSettingsPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const sp = await searchParams;

  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/settings`)}`
    );
  }

  if (sp.connect === "return" || sp.connect === "refresh") {
    if (isMarketplaceUiEnabled()) {
      const existing = await fetchSellerPayoutAccount(supabase, user.id);
      if (existing?.stripeAccountId) {
        await refreshConnectAccountFromStripe(existing.stripeAccountId);
      }
    }
  }

  const course = await fetchCourseForDashboard(supabase, courseId, user.id);
  if (!course) notFound();
  if (!course.can_manage_collaborators) {
    redirect(`/dashboard/courses/${courseId}`);
  }
  if (course.is_self_study) {
    redirect(`/dashboard/courses/${courseId}`);
  }

  const { count: uploadsCount } = await supabase
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("course_id", course.id);

  const publishing = await fetchCoursePublishingPanels(supabase, {
    courseId: course.id,
    userId: user.id,
    isPublic: Boolean(course.is_public),
    uploadsCount: uploadsCount ?? 0,
  });

  const settingsPath = `/dashboard/courses/${courseId}/settings`;
  const statusLabel = publishingStatusLabel(publishing);
  const marketplaceEnabled = isMarketplaceUiEnabled();

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <Link
            href={`/dashboard/courses/${courseId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand transition hover:gap-2 dark:text-brand-soft"
          >
            <span aria-hidden>←</span> Back to course workspace
          </Link>

          <p className="mt-8 text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Course settings
          </p>
          <div className="mt-2">
            <EditableCourseTitle
              courseId={course.id}
              initialTitle={course.title}
              accent="brand"
            />
          </div>
          {course.description ? (
            <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
              {course.description}
            </p>
          ) : null}

          <p className="mt-6 rounded-2xl border border-zinc-200/90 bg-white/80 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-300">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Status:
            </span>{" "}
            {statusLabel}
          </p>

          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {marketplaceEnabled
              ? "Control who can discover and access this course. Free Explore and paid marketplace listings are mutually exclusive — pick one path for learners outside your workspace."
              : "Control whether this course appears on Explore for signed-in learners, or stays private to your workspace."}
          </p>

          <div className="mt-8">
            <CourseVisibilityToggle
              courseId={course.id}
              initialPublic={publishing.isPublic}
              listingBlocksExplore={publishing.listingBlocksExplore}
              marketplaceEnabled={marketplaceEnabled}
            />
          </div>

          {marketplaceEnabled ? (
            <>
              <SellerConnectPanel
                initialState={publishing.sellerConnectState}
                returnPath={settingsPath}
              />

              <CourseListingPanel
                courseId={course.id}
                initialListing={publishing.initialListing}
                hasMaterials={publishing.hasMaterials}
              />
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}
