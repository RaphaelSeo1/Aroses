import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CourseCreatorOverview } from "@/components/CourseCreatorOverview";
import { CourseVisibilityToggle } from "@/components/CourseVisibilityToggle";
import { EditableCourseTitle } from "@/components/EditableCourseTitle";
import {
  ExamGroupsPanel,
  type ExamGroupRow,
  type MaterialRow,
} from "@/components/ExamGroupsPanel";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { ShareCourseButton } from "@/components/ShareCourseButton";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ section?: string }>;
};

export default async function CourseDetailPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const sp = await searchParams;
  const sectionFromUrl =
    typeof sp.section === "string" && UUID_RE.test(sp.section)
      ? sp.section
      : null;

  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}`)}`);
  }

  const course = await fetchCourseForDashboard(supabase, courseId, user.id);

  if (!course) notFound();

  const { data: groupsRaw } = await supabase
    .from("exam_groups")
    .select("id, name, sort_order")
    .eq("course_id", course.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  let groups: ExamGroupRow[] = groupsRaw ?? [];

  // For self-study courses, hide the section concept entirely by auto-creating
  // a single default group ("My materials") so the upload form has somewhere
  // to write to. The ExamGroupsPanel will render with just this one tab.
  if (course.is_self_study && groups.length === 0) {
    const { data: created } = await supabase
      .from("exam_groups")
      .insert({
        course_id: course.id,
        user_id: user.id,
        name: "My materials",
        sort_order: 0,
      })
      .select("id, name, sort_order")
      .single();
    if (created) groups = [created];
  }

  const { data: materialsRaw } = await supabase
    .from("study_materials")
    .select("id, file_name, created_at, exam_group_id, sort_order, course_payload")
    .eq("course_id", course.id);

  // Fetch any PDF ingest jobs that failed or are stuck, so we can warn the user.
  const { data: failedJobsRaw } = await supabase
    .from("pdf_ingest_jobs")
    .select("id, original_file_name, status, exam_group_id, error_message")
    .eq("course_id", course.id)
    .in("status", ["failed"]);

  const materials: MaterialRow[] = sortStudyMaterialsForDashboard(
    (materialsRaw ?? [])
      .filter(
        (m): m is (typeof m & { exam_group_id: string }) =>
          typeof m.exam_group_id === "string" && m.exam_group_id.length > 0
      )
      .map((m) => ({
        id: m.id,
        file_name: m.file_name,
        created_at: m.created_at,
        exam_group_id: m.exam_group_id,
        sort_order:
          typeof m.sort_order === "number" && Number.isFinite(m.sort_order)
            ? m.sort_order
            : 0,
        course_payload: m.course_payload ?? undefined,
      })),
    groups.map((g) => g.id)
  );

  let modulesTotal = 0;
  for (const m of materialsRaw ?? []) {
    const pl = m.course_payload as CoursePayload | null;
    modulesTotal += pl?.modules?.length ?? 0;
  }

  const uploadsCount = materialsRaw?.length ?? 0;

  type FailedJob = { id: string; original_file_name: string | null; exam_group_id: string | null; error_message: string | null };
  const failedJobs: FailedJob[] = (failedJobsRaw ?? []).map((j) => ({
    id: j.id,
    original_file_name: typeof j.original_file_name === "string" ? j.original_file_name : null,
    exam_group_id: typeof j.exam_group_id === "string" ? j.exam_group_id : null,
    error_message: typeof j.error_message === "string" ? j.error_message : null,
  }));

  const adminViewingOthersCourse =
    typeof course.owner_user_id === "string" &&
    course.owner_user_id !== user.id;

  const isSelfStudy = Boolean(course.is_self_study);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          {adminViewingOthersCourse ? (
            <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
              Admin: you are editing someone else&apos;s course in the creator
              workspace. Materials and sections stay attributed to the course
              owner.
            </p>
          ) : null}

          {isSelfStudy ? (
            <>
              {/* ── Self Study header ───────────────────────────────────── */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    <span>🎯</span> Self study
                  </p>
                  <div className="mt-2">
                    <EditableCourseTitle
                      courseId={course.id}
                      initialTitle={course.title}
                      accent="indigo"
                    />
                  </div>
                  <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    Private to you · not shown on Explore
                  </p>
                </div>
                <ShareCourseButton courseId={course.id} accent="indigo" />
              </div>

              {/* Note: per-upload goals replaced the course-wide "your study
                  goal" badge — each PDF carries its own focus statement now. */}

              {/* Quick stats — simplified, no "manage" framing */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                    PDFs uploaded
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {uploadsCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                    Lessons built
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {modulesTotal}
                  </p>
                </div>
              </div>

              {uploadsCount > 0 ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={`/dashboard/courses/${course.id}/learn`}
                    className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                  >
                    Start learning →
                  </Link>
                  <Link
                    href={`/dashboard/courses/${course.id}/study`}
                    className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Open study room
                  </Link>
                </div>
              ) : null}

              {/* Upload area — single bucket, no section talk */}
              <div className="mt-10">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  Your materials
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Drop in the PDFs you want to study. The AI will turn them
                  into lessons calibrated to your goal above.
                </p>
                <div className="mt-5">
                  <ExamGroupsPanel
                    courseId={course.id}
                    groups={groups}
                    materials={materials}
                    failedJobs={failedJobs}
                    initialSectionId={sectionFromUrl ?? undefined}
                    isSelfStudy
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* ── Standard public-course workspace ────────────────────── */}
              <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Course workspace
              </p>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <EditableCourseTitle
                    courseId={course.id}
                    initialTitle={course.title}
                    accent="brand"
                  />
                </div>
                <ShareCourseButton courseId={course.id} />
              </div>
              {course.description ? (
                <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {course.description}
                </p>
              ) : null}

              <CourseCreatorOverview
                courseId={course.id}
                uploadsCount={uploadsCount}
                modulesTotal={modulesTotal}
              />

              <div className="mt-10">
                <CourseVisibilityToggle
                  courseId={course.id}
                  initialPublic={Boolean(course.is_public)}
                />
              </div>

              <ExamGroupsPanel
                courseId={course.id}
                groups={groups}
                materials={materials}
                failedJobs={failedJobs}
                initialSectionId={sectionFromUrl ?? undefined}
              />
            </>
          )}
        </div>
      </main>
    </>
  );
}
