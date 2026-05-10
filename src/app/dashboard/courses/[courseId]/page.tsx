import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CourseCreatorOverview } from "@/components/CourseCreatorOverview";
import { CourseVisibilityToggle } from "@/components/CourseVisibilityToggle";
import {
  ExamGroupsPanel,
  type ExamGroupRow,
  type MaterialRow,
} from "@/components/ExamGroupsPanel";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ courseId: string }> };

export default async function CourseDetailPage({ params }: Props) {
  const { courseId } = await params;

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

  const groups: ExamGroupRow[] = groupsRaw ?? [];

  const { data: materialsRaw } = await supabase
    .from("study_materials")
    .select("id, file_name, created_at, exam_group_id, sort_order")
    .eq("course_id", course.id);

  const materials: MaterialRow[] = sortStudyMaterialsForDashboard(
    (materialsRaw ?? [])
      .filter(
        (m): m is (typeof m & { exam_group_id: string }) =>
          typeof m.exam_group_id === "string" && m.exam_group_id.length > 0
      )
      .map((m) => ({
        ...m,
        sort_order:
          typeof m.sort_order === "number" && Number.isFinite(m.sort_order)
            ? m.sort_order
            : 0,
      })),
    groups.map((g) => g.id)
  );

  const { data: statsMaterials } = await supabase
    .from("study_materials")
    .select("id, course_payload")
    .eq("course_id", course.id);

  let modulesTotal = 0;
  for (const m of statsMaterials ?? []) {
    const pl = m.course_payload as CoursePayload | null;
    modulesTotal += pl?.modules?.length ?? 0;
  }

  const uploadsCount = statsMaterials?.length ?? 0;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Course workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {course.title}
          </h1>
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
          />
        </div>
      </main>
    </>
  );
}
