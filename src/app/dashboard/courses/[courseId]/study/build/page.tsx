import { notFound, redirect } from "next/navigation";
import { CourseBuildTheater } from "@/components/CourseBuildTheater";
import { fetchSrsDueCountsForUser } from "@/lib/srs-due-counts-server";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ pdfJobs?: string; section?: string }>;
};

function parsePdfJobIds(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((id) => UUID_RE.test(id))
    .slice(0, 12);
}

export default async function CourseStudyBuildPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const sp = await searchParams;

  if (!UUID_RE.test(courseId)) notFound();

  const pdfJobIds = parsePdfJobIds(
    typeof sp.pdfJobs === "string" ? sp.pdfJobs : undefined
  );
  if (pdfJobIds.length === 0) {
    redirect(`/dashboard/courses/${courseId}`);
  }

  const sectionFromUrl =
    typeof sp.section === "string" && UUID_RE.test(sp.section)
      ? sp.section
      : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/study/build?pdfJobs=${pdfJobIds.join(",")}${sectionFromUrl ? `&section=${sectionFromUrl}` : ""}`)}`
    );
  }

  const courseRow = await fetchCourseForDashboard(supabase, courseId, user.id);

  if (!courseRow) notFound();

  const courseTitle = courseRow.title?.trim() || "Course";
  const initialDueCounts = await fetchSrsDueCountsForUser(supabase, user.id);

  return (
    <CourseBuildTheater
      courseId={courseId}
      jobIds={pdfJobIds}
      sectionId={sectionFromUrl}
      courseTitle={courseTitle}
      initialDueCounts={initialDueCounts}
    />
  );
}
