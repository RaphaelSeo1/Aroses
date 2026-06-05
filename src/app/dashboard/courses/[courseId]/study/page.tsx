import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { AppHeader } from "@/components/AppHeader";
import { CourseWorkspaceBackRow } from "@/components/CourseWorkspaceBackRow";
import { IngestMediaPanel } from "@/components/IngestMediaPanel";
import { CoursePlayer } from "@/components/CoursePlayer";
import { parseIngestMedia } from "@/types/ingest-media";
import { StudyChatDrawer } from "@/components/StudyChatDrawer";
import { VoiceTutorDock } from "@/components/VoiceTutorDock";
import { HighlightedSummary } from "@/components/HighlightedSummary";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { McqQuiz } from "@/components/McqQuiz";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import {
  loadCourseProgress,
  upsertCourseProgress,
} from "@/lib/course-progress/db";
import { resolveMentoredModuleForMaterial } from "@/lib/study/resolve-mentored-module";
import { resolveResumeTarget } from "@/lib/study/resolve-resume-target";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import {
  selectLatestStudyMaterialForCourse,
  selectStudyMaterialById,
} from "@/lib/supabase/select-study-material";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload, SidebarMaterialOutline } from "@/types/course";
import type { MCQuestion } from "@/types/study";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{
    material?: string;
    module?: string;
    mode?: string;
    lesson?: string;
    scroll?: string;
    manage?: string;
  }>;
};

export default async function StudyPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const {
    material: materialId,
    module: moduleParam,
    mode: modeParam,
    lesson: lessonParam,
    scroll: scrollParam,
    manage: manageParam,
  } = await searchParams;
  // Explicit edit intent (from "Edit course"). When managing we never fall
  // into learn mode, even if saved progress says the last session was "free".
  const manageMode = manageParam === "1";
  const learnMode = !manageMode && modeParam === "learn";

  const moduleNum =
    typeof moduleParam === "string" ? Number(moduleParam) : Number.NaN;
  let initialModuleFromUrl = Number.isFinite(moduleNum)
    ? moduleNum
    : undefined;
  const lessonNum =
    typeof lessonParam === "string" ? Number(lessonParam) : Number.NaN;
  let initialLessonIndex = Number.isFinite(lessonNum) ? lessonNum : undefined;
  const scrollNum =
    typeof scrollParam === "string" ? Number(scrollParam) : Number.NaN;
  let initialScrollPosition = Number.isFinite(scrollNum) ? scrollNum : undefined;

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

  const courseRow = await fetchCourseForDashboard(supabase, courseId, user.id);

  if (!courseRow) notFound();

  const courseTitle = courseRow.title?.trim() || "Course";

  const savedProgress = await loadCourseProgress(
    supabase,
    user.id,
    courseRow.id
  );

  // `material=` without `module=` — resume from saved course progress when
  // the student was in Free Exploration; otherwise fall back to mentored session.
  if (
    typeof materialId === "string" &&
    UUID_RE.test(materialId) &&
    initialModuleFromUrl == null
  ) {
    if (
      savedProgress?.materialId === materialId &&
      savedProgress.lastModuleId != null &&
      (savedProgress.lastMode === "free" || learnMode)
    ) {
      initialModuleFromUrl = savedProgress.lastModuleId;
    } else {
      const resolved = await resolveMentoredModuleForMaterial(
        supabase,
        user.id,
        materialId
      );
      if (resolved != null) initialModuleFromUrl = resolved;
    }
  }

  // Entry-point shortcut: when the URL doesn't already specify which
  // material + module to open (i.e. the user tapped "Learn" / "Continue"
  // from a course tile), redirect to wherever they last left off. Falls
  // back to the earliest module of the earliest material if no progress
  // exists yet. Without this, the study page used to grab the first
  // material in sort_order and module 1 — which felt random the moment a
  // user had progress further along.
  if (!materialId && initialModuleFromUrl == null) {
    const target = await resolveResumeTarget(supabase, courseRow.id, user.id);
    if (target) {
      const qs = new URLSearchParams();
      qs.set("material", target.materialId);
      if (target.moduleId != null) qs.set("module", String(target.moduleId));
      if (target.lessonIndex != null) qs.set("lesson", String(target.lessonIndex));
      if (target.scrollPosition != null && target.scrollPosition > 0) {
        qs.set("scroll", String(target.scrollPosition));
      }
      if (manageMode) {
        // Preserve edit intent across the resume redirect; do NOT coerce to
        // learn mode.
        qs.set("manage", "1");
      } else if (learnMode || target.mode === "free") {
        qs.set("mode", "learn");
      }
      redirect(`/dashboard/courses/${courseId}/study?${qs.toString()}`);
    }
  }

  type StudyRow = {
    id: string;
    summary: string;
    key_concepts: string[] | null;
    questions: unknown;
    course_id: string;
    file_name: string;
    course_payload: unknown | null;
    ingest_media?: unknown | null;
  };

  let row: StudyRow | null = null;

  if (materialId) {
    const { data, error } = await selectStudyMaterialById(
      supabase,
      materialId,
      courseRow.id
    );

    if (error) {
      console.error(error);
      redirect(`/dashboard/courses/${courseId}`);
    }
    row = data;
  } else {
    const { data, error } = await selectLatestStudyMaterialForCourse(
      supabase,
      courseRow.id
    );

    if (error) {
      console.error(error);
      redirect(`/dashboard/courses/${courseId}`);
    }
    row = data;
  }

  if (!row) {
    return (
      <>
        <AppHeader right={<HeaderNavLoggedInServer />} />
        <CourseWorkspaceBackRow
          courseId={courseId}
          courseTitle={courseTitle}
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
      .eq("material_id", row.id)
      .eq("user_id", user.id);

    if (!ce && comp) {
      completedModuleIds = comp.map((c) => c.module_id);
    }
  }

  let sidebarOutlines: SidebarMaterialOutline[] = [];
  if (hasNewCourse && payload) {
    const { data: groupsOrder } = await supabase
      .from("exam_groups")
      .select("id, name")
      .eq("course_id", courseRow.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    const examGroupRows = (groupsOrder ?? []) as { id: string; name: string }[];
    const examGroupTabOrder = examGroupRows.map((g) => g.id);
    const examGroupNameById = new Map(examGroupRows.map((g) => [g.id, g.name]));

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
        .in("material_id", outlineIds)
        .eq("user_id", user.id);

      for (const c of compRows ?? []) {
        const arr = compByMaterial.get(c.material_id) ?? [];
        arr.push(c.module_id);
        compByMaterial.set(c.material_id, arr);
      }
    }

    sidebarOutlines = outlineRows.map((r) => {
      const p = r.course_payload as CoursePayload;
      const egId = typeof r.exam_group_id === "string" ? r.exam_group_id : undefined;
      return {
        materialId: r.id,
        fileName: displayMaterialSectionLabel(r.file_name),
        modules: p.modules.map((m) => ({ id: m.id, title: m.title })),
        completedModuleIds: compByMaterial.get(r.id) ?? [],
        examGroupId: egId,
        examGroupName: egId ? (examGroupNameById.get(egId) ?? undefined) : undefined,
      };
    });
  }

  if (hasNewCourse && payload) {
    if (
      savedProgress?.materialId === row.id &&
      initialModuleFromUrl == null &&
      savedProgress.lastModuleId != null
    ) {
      initialModuleFromUrl = savedProgress.lastModuleId;
    }
    if (savedProgress?.materialId === row.id && initialLessonIndex == null) {
      initialLessonIndex = savedProgress.lastLessonIndex;
    }
    if (
      savedProgress?.materialId === row.id &&
      initialScrollPosition == null &&
      savedProgress.lastScrollPosition != null
    ) {
      initialScrollPosition = savedProgress.lastScrollPosition;
    }

    const openModuleId =
      (initialModuleFromUrl != null &&
        payload.modules.some((m) => m.id === initialModuleFromUrl) &&
        initialModuleFromUrl) ||
      payload.modules[0]?.id;

    if (openModuleId != null) {
      await upsertCourseProgress(supabase, user.id, courseRow.id, {
        materialId: row.id,
        lastModuleId: openModuleId,
        lastMode: "free",
        lastLessonIndex: initialLessonIndex ?? 0,
        lastScrollPosition: initialScrollPosition ?? undefined,
      });
    }

    const ingestMedia = parseIngestMedia(row.ingest_media);

    return (
      <>
        <AppHeader right={<HeaderNavLoggedInServer />} />
        <CourseWorkspaceBackRow
          courseId={courseId}
          courseTitle={courseTitle}
        />
        <div className="border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
          <p className="mx-auto max-w-7xl text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {displayMaterialSectionLabel(row.file_name)}
          </p>
        </div>
        {ingestMedia ? (
          <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
            <IngestMediaPanel materialId={row.id} media={ingestMedia} />
          </div>
        ) : null}
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
          initialLessonIndex={initialLessonIndex}
          initialScrollPosition={initialScrollPosition}
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
        <AppHeader right={<HeaderNavLoggedInServer />} />
        <CourseWorkspaceBackRow
          courseId={courseId}
          courseTitle={courseTitle}
        />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Legacy study pack — upload again for the full course experience
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
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
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <VoiceTutorDock
            key={row.id}
            materialId={row.id}
            moduleId={1}
            quizOpen={false}
            courseId={courseId}
            studyHrefBase={`/dashboard/courses/${courseId}/study`}
            docked
            variant="legacy"
          />
          <StudyChatDrawer
            materialId={row.id}
            moduleId={1}
            quizOpen={false}
            courseId={courseId}
            studyHrefBase={`/dashboard/courses/${courseId}/study`}
            docked
            variant="legacy"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <CourseWorkspaceBackRow
        courseId={courseId}
        courseTitle={courseTitle}
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
