import Link from "next/link";
import {
  courseSettingsHref,
  publishingStatusLabel,
  type CoursePublishingSummary,
} from "@/lib/marketplace/course-publishing-data";

export function CoursePublishingEntry({
  courseId,
  summary,
}: {
  courseId: string;
  summary: CoursePublishingSummary;
}) {
  const status = publishingStatusLabel(summary);
  const href = courseSettingsHref(courseId);

  const statusTone =
    summary.listingStatus === "approved"
      ? "text-emerald-700 dark:text-emerald-300"
      : summary.listingStatus === "pending_review"
        ? "text-amber-700 dark:text-amber-300"
        : summary.listingStatus === "rejected"
          ? "text-red-700 dark:text-red-300"
          : summary.isPublic
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-zinc-600 dark:text-zinc-400";

  return (
    <section className="mt-10 rounded-3xl border border-zinc-200/90 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Publishing &amp; sales
          </p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Course visibility &amp; marketplace
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Choose free Explore, paid listing, or keep the course private.
            Payout setup and seller attestation live on a dedicated settings
            page so this workspace stays focused on materials.
          </p>
          <p className={`mt-3 text-sm font-semibold ${statusTone}`}>
            Current: {status}
            {!summary.payoutsReady &&
            summary.paymentsConfigured &&
            (summary.listingStatus === "draft" ||
              summary.listingStatus === "pending_review" ||
              summary.listingStatus === "approved" ||
              summary.listingStatus === "rejected") ? (
              <span className="ml-2 font-normal text-amber-700 dark:text-amber-300">
                · Payout setup incomplete
              </span>
            ) : null}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-md shadow-red-600/20 transition hover:bg-brand-hover dark:bg-brand"
        >
          Manage course settings →
        </Link>
      </div>
    </section>
  );
}
