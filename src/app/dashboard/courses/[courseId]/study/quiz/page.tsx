import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { CourseWorkspaceBackRow } from "@/components/CourseWorkspaceBackRow";
import { CoursePlayer } from "@/components/CoursePlayer";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { summarizeCourseProgress } from "@/lib/learning-stats";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload, SidebarMaterialOutline } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ material?: string; module?: string; mode?: string }>;
};

export default async function StudyQuizPracticePage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const { material: materialId, module: moduleParam, mode: modeParam } =
    await searchParams;
  const learnMode = modeParam === "learn";

  const moduleNum =
    typeof moduleParam === "string" ? Number(moduleParam) : Number.NaN;
  const initialModuleFromUrl = Number.isFinite(moduleNum)
    ? moduleNum
    : undefined;

  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/study/quiz`)}`
    );
  }

  const courseRow = await fetchCourseForDashboard(supabase, courseId, user.id);

  if (!courseRow) notFound();

  const courseTitle = courseRow.title?.trim() || "Course";

  let row: {
    id: string;
    course_id: string;
    file_name: string;
    course_payload: unknown | null;
  } | null = null;

  if (materialId) {
    const { data, error } = await supabase
      .from("study_materials")
      .select("id, course_id, file_name, course_payload")
      .eq("id", materialId)
      .eq("course_id", courseRow.id)
      .maybeSingle();

    if (error) {
      console.error(error);
      redirect(`/dashboard/courses/${courseId}`);
    }
    row = data;
  } else {
    const { data, error } = await supabase
      .from("study_materials")
      .select("id, course_id, file_name, course_payload")
      .eq("course_id", courseRow.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      redirect(`/dashboard/courses/${courseId}`);
    }
    row = data;
  }

  const studyFallback =
    learnMode
      ? `/dashboard/courses/${courseId}/study?mode=learn`
      : `/dashboard/courses/${courseId}/study`;

  if (!row) {
    redirect(studyFallback);
  }

  const payload = row.course_payload as CoursePayload | null | undefined;
  const hasNewCourse =
    payload &&
    typeof payload.title === "string" &&
    Array.isArray(payload.modules) &&
    payload.modules.length > 0;

  if (!hasNewCourse || !payload) {
    redirect(studyFallback);
  }

  let completedModuleIds: number[] = [];
  const { data: comp } = await supabase
    .from("module_completion")
    .select("module_id")
    .eq("material_id", row.id);

  if (comp) {
    completedModuleIds = comp.map((c) => c.module_id);
  }

  let sidebarOutlines: SidebarMaterialOutline[] = [];
  const { data: groupsOrder } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("course_id", courseRow.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const examGroupTabOrder = (groupsOrder ?? []).map((g) => g.id);

  const { data: allMaterials } = await supabase
    .from("study_materials")
    .select(
      "id, file_name, course_payload, exam_group_id, sort_order, created_at"
    )
    .eq("course_id", courseRow.id);

  const outlineCandidates = (allMaterials ?? []).filter((r) => {
    const p = r.course_payload as CoursePayload | null;
    return Boolean(p?.modules?.length);
  });

  const outlineRows = sortStudyMaterialsForDashboard(
    outlineCandidates,
    examGroupTabOrder
  );

  const outlineIds = outlineRows.map((r) => r.id);
  const compByMaterial = new Map<string, number[]>();
  let completionRows: { material_id: string; module_id: number }[] = [];

  if (outlineIds.length > 0) {
    const { data: compRows } = await supabase
      .from("module_completion")
      .select("material_id, module_id")
      .in("material_id", outlineIds);

    completionRows = compRows ?? [];
    for (const c of completionRows) {
      const arr = compByMaterial.get(c.material_id) ?? [];
      arr.push(c.module_id);
      compByMaterial.set(c.material_id, arr);
    }
  }

  const { data: attemptRows } =
    outlineIds.length > 0
      ? await supabase
          .from("question_attempts")
          .select("material_id, is_correct")
          .in("material_id", outlineIds)
      : { data: [] };

  const courseProgressSummary = summarizeCourseProgress({
    course: {
      id: courseRow.id,
      title: courseRow.title,
      description: courseRow.description || null,
    },
    materials: outlineRows.map((r) => ({
      id: r.id,
      course_id: courseRow.id,
      file_name: r.file_name,
      course_payload: r.course_payload,
    })),
    completions: completionRows,
    attempts: attemptRows ?? [],
  });

  sidebarOutlines = outlineRows.map((r) => {
    const p = r.course_payload as CoursePayload;
    return {
      materialId: r.id,
      fileName: displayMaterialSectionLabel(r.file_name),
      modules: p.modules.map((m) => ({ id: m.id, title: m.title })),
      completedModuleIds: compByMaterial.get(r.id) ?? [],
    };
  });

  const lessonsQs = new URLSearchParams();
  lessonsQs.set("material", row.id);
  if (initialModuleFromUrl != null) {
    lessonsQs.set("module", String(initialModuleFromUrl));
  }
  if (learnMode) lessonsQs.set("mode", "learn");
  const lessonsHref = `/dashboard/courses/${courseId}/study?${lessonsQs.toString()}`;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <CourseWorkspaceBackRow
        courseId={courseId}
        courseTitle={courseTitle}
      />
      <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">
            {displayMaterialSectionLabel(row.file_name)}
          </span>
          <span className="text-zinc-400">·</span>
          <span className="rounded-full bg-brand-blush px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink dark:bg-[#1e1616]/80 dark:text-brand-soft">
            Practice
          </span>
          <span className="text-zinc-400">·</span>
          <Link
            href={lessonsHref}
            className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
          >
            Back to lecture
          </Link>
        </p>
      </div>
      <Suspense
        fallback={
          <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-zinc-500 dark:text-zinc-400">
            Loading practice…
          </div>
        }
      >
        <CoursePlayer
          key={`${row.id}-quiz`}
          courseId={courseId}
          course={payload}
          materialId={row.id}
          sourceLabel={displayMaterialSectionLabel(row.file_name)}
          initialCompletedModuleIds={completedModuleIds}
          sidebarOutlines={sidebarOutlines}
          initialModuleFromUrl={initialModuleFromUrl}
          mode="quiz"
          courseManageEnabled={!learnMode}
          learnMode={learnMode}
          workspaceCourseTitle={courseRow.title}
          practiceProgressCourseSummary={courseProgressSummary}
        />
      </Suspense>
    </>
  );
}
