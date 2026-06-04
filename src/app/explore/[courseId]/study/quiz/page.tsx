import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import {
  AppHeader,
} from "@/components/AppHeader";
import { CoursePlayer } from "@/components/CoursePlayer";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { summarizeCourseProgress } from "@/lib/learning-stats";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { createClient } from "@/lib/supabase/server";
import { loadExploreStudyCourse } from "@/lib/marketplace/explore-study-guard";
import type { CoursePayload, SidebarMaterialOutline } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{
    material?: string;
    module?: string;
    practice?: string;
  }>;
};

export default async function ExploreStudyQuizPage({
  params,
  searchParams,
}: Props) {
  const { courseId } = await params;
  const sp = await searchParams;

  const moduleNum =
    typeof sp.module === "string" ? Number(sp.module) : Number.NaN;
  const initialModuleFromUrl = Number.isFinite(moduleNum)
    ? moduleNum
    : undefined;
  const materialId =
    typeof sp.material === "string" ? sp.material : undefined;

  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const quizBase = `/explore/${courseId}/study/quiz`;
  const quizQs = new URLSearchParams();
  if (typeof sp.material === "string" && UUID_RE.test(sp.material)) {
    quizQs.set("material", sp.material);
  }
  if (typeof sp.module === "string" && sp.module.trim().length > 0) {
    quizQs.set("module", sp.module.trim());
  }
  if (typeof sp.practice === "string" && sp.practice.trim().length > 0) {
    quizQs.set("practice", sp.practice.trim());
  }
  const quizNext =
    quizQs.toString().length > 0 ? `${quizBase}?${quizQs}` : quizBase;

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(quizNext)}`);
  }

  const courseRow = await loadExploreStudyCourse(supabase, user.id, courseId);

  const studyBase = `/explore/${courseId}/study`;

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
      redirect(studyBase);
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
      redirect(studyBase);
    }
    row = data;
  }

  if (!row) {
    redirect(studyBase);
  }

  const payload = row.course_payload as CoursePayload | null | undefined;
  const hasNewCourse =
    payload &&
    typeof payload.title === "string" &&
    Array.isArray(payload.modules) &&
    payload.modules.length > 0;

  if (!hasNewCourse || !payload) {
    redirect(studyBase);
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

  const courseProgressSummary =
    user != null
      ? summarizeCourseProgress({
          course: courseRow,
          materials: outlineRows.map((r) => ({
            id: r.id,
            course_id: courseRow.id,
            file_name: r.file_name,
            course_payload: r.course_payload,
          })),
          completions: completionRows,
          attempts: attemptRows ?? [],
        })
      : null;

  sidebarOutlines = outlineRows.map((r) => {
    const p = r.course_payload as CoursePayload;
    return {
      materialId: r.id,
      fileName: displayMaterialSectionLabel(r.file_name),
      modules: p.modules.map((m) => ({ id: m.id, title: m.title })),
      completedModuleIds: compByMaterial.get(r.id) ?? [],
    };
  });

  const lessonsHref = `${studyBase}?material=${encodeURIComponent(row.id)}${initialModuleFromUrl != null ? `&module=${encodeURIComponent(String(initialModuleFromUrl))}` : ""}`;

  const headerRight =
    user ? (
      <HeaderNavLoggedInServer adminHubHref={adminHubHrefForSessionUser(user)} />
    ) : (
      <>
        <HeaderNavLink href="/explore">Explore</HeaderNavLink>
        <HeaderNavLink href="/login">Log in</HeaderNavLink>
        <HeaderNavLink href="/signup" variant="primary">
          Sign up
        </HeaderNavLink>
      </>
    );

  return (
    <>
      <AppHeader right={headerRight} />
      <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <Link
            href={`/explore/${courseId}`}
            className="font-medium text-zinc-700 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-300 dark:hover:text-brand-soft"
          >
            {courseRow.title}
          </Link>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-600 dark:text-zinc-400">
            {displayMaterialSectionLabel(row.file_name)}
          </span>
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
          studyHrefBase={studyBase}
          courseManageEnabled={false}
          workspaceCourseTitle={courseProgressSummary ? courseRow.title : undefined}
          practiceProgressCourseSummary={courseProgressSummary ?? undefined}
        />
      </Suspense>
    </>
  );
}
