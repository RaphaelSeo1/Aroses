import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { AppHeader } from "@/components/AppHeader";
import { CoursePlayer } from "@/components/CoursePlayer";
import { StudyChatDrawer } from "@/components/StudyChatDrawer";
import { HighlightedSummary } from "@/components/HighlightedSummary";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { McqQuiz } from "@/components/McqQuiz";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload, SidebarMaterialOutline } from "@/types/course";
import type { MCQuestion } from "@/types/study";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ material?: string; module?: string; mode?: string }>;
};

export default async function StudyPage({ params, searchParams }: Props) {
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
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/study`)}`
    );
  }

  const adminHubHref = isAppAdminEnvUser({
    id: user.id,
    email: user.email,
  })
    ? "/dashboard/admin"
    : undefined;

  const courseRow = await fetchCourseForDashboard(supabase, courseId, user.id);

  if (!courseRow) notFound();

  let row: {
    id: string;
    summary: string;
    key_concepts: string[] | null;
    questions: unknown;
    course_id: string;
    file_name: string;
    course_payload: unknown | null;
  } | null = null;

  if (materialId) {
    const { data, error } = await supabase
      .from("study_materials")
      .select(
        "id, summary, key_concepts, questions, course_id, file_name, course_payload"
      )
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
      .select(
        "id, summary, key_concepts, questions, course_id, file_name, course_payload"
      )
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

  if (!row) {
    return (
      <>
        <AppHeader
          right={
            <HeaderNavLoggedIn
              adminHubHref={adminHubHref}
              courseHomeHref={`/dashboard/courses/${courseId}`}
            />
          }
        />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            No generated course yet
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Upload a PDF on your course page to build lessons and quizzes.
          </p>
          <Link
            href={`/dashboard/courses/${courseId}`}
            className="mt-6 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Go to uploads
          </Link>
        </main>
      </>
    );
  }

  const payload = row.course_payload as CoursePayload | null | undefined;
  const hasNewCourse =
    payload &&
    typeof payload.title === "string" &&
    Array.isArray(payload.modules) &&
    payload.modules.length > 0;

  const legacyQuestions = row.questions as unknown as MCQuestion[];
  const hasLegacy =
    !hasNewCourse &&
    Array.isArray(legacyQuestions) &&
    legacyQuestions.length > 0;

  let completedModuleIds: number[] = [];
  if (hasNewCourse) {
    const { data: comp, error: ce } = await supabase
      .from("module_completion")
      .select("module_id")
      .eq("material_id", row.id);

    if (!ce && comp) {
      completedModuleIds = comp.map((c) => c.module_id);
    }
  }

  let sidebarOutlines: SidebarMaterialOutline[] = [];
  if (hasNewCourse && payload) {
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

    if (outlineIds.length > 0) {
      const { data: compRows } = await supabase
        .from("module_completion")
        .select("material_id, module_id")
        .in("material_id", outlineIds);

      for (const c of compRows ?? []) {
        const arr = compByMaterial.get(c.material_id) ?? [];
        arr.push(c.module_id);
        compByMaterial.set(c.material_id, arr);
      }
    }

    sidebarOutlines = outlineRows.map((r) => {
      const p = r.course_payload as CoursePayload;
      return {
        materialId: r.id,
        fileName: displayMaterialSectionLabel(r.file_name),
        modules: p.modules.map((m) => ({ id: m.id, title: m.title })),
        completedModuleIds: compByMaterial.get(r.id) ?? [],
      };
    });
  }

  if (hasNewCourse && payload) {
    return (
      <>
        <AppHeader
          right={
            <HeaderNavLoggedIn
              adminHubHref={adminHubHref}
              courseHomeHref={`/dashboard/courses/${courseId}`}
            />
          }
        />
        <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
          <p className="mx-auto max-w-7xl text-xs text-zinc-500">
            <Link
              href={`/dashboard/courses/${courseId}`}
              className="font-medium text-zinc-700 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-300 dark:hover:text-brand-soft"
            >
              {courseRow.title}
            </Link>
            <span className="mx-2 text-zinc-400">·</span>
            <span className="text-zinc-600 dark:text-zinc-400">
              {displayMaterialSectionLabel(row.file_name)}
            </span>
          </p>
        </div>
        <CoursePlayer
          key={row.id}
          mode="lessons"
          courseId={courseId}
          course={payload}
          materialId={row.id}
          sourceLabel={displayMaterialSectionLabel(row.file_name)}
          initialCompletedModuleIds={completedModuleIds}
          sidebarOutlines={sidebarOutlines}
          initialModuleFromUrl={initialModuleFromUrl}
          courseManageEnabled={!learnMode}
          learnMode={learnMode}
        />
      </>
    );
  }

  if (hasLegacy) {
    const keyConcepts = row.key_concepts ?? [];
    return (
      <>
        <AppHeader
          right={
            <HeaderNavLoggedIn
              adminHubHref={adminHubHref}
              courseHomeHref={`/dashboard/courses/${courseId}`}
            />
          }
        />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Legacy study pack — upload again for the full course experience
          </p>
          <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
            <Link
              href={`/dashboard/courses/${courseId}`}
              className="font-medium underline-offset-2 hover:text-brand hover:underline dark:hover:text-brand-soft"
            >
              {courseRow.title}
            </Link>
            <span className="mx-1.5 text-zinc-400">·</span>
            {displayMaterialSectionLabel(row.file_name)}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Study pack
          </h1>
          <AiStudyDisclaimer className="mt-5" />
          <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Summary
            </h2>
            <div className="mt-4">
              <HighlightedSummary
                summary={row.summary}
                keyConcepts={keyConcepts}
              />
            </div>
          </section>
          <section className="mt-12">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Practice questions
            </h2>
            <div className="mt-4">
              <McqQuiz materialId={row.id} questions={legacyQuestions} />
            </div>
          </section>
        </main>
        <div className="fixed bottom-6 right-6 z-[100] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <StudyChatDrawer
            materialId={row.id}
            moduleId={1}
            quizOpen={false}
            docked
            variant="legacy"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader
        right={
          <HeaderNavLoggedIn
            adminHubHref={adminHubHref}
            courseHomeHref={`/dashboard/courses/${courseId}`}
          />
        }
      />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Could not load course content
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Re-upload your PDF from the course page, or run the latest database
          migration if you haven&apos;t yet.
        </p>
        <Link
          href={`/dashboard/courses/${courseId}`}
          className="mt-6 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Go to course home
        </Link>
      </main>
    </>
  );
}
