import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import {
  AppHeader,
} from "@/components/AppHeader";
import { CoursePlayer } from "@/components/CoursePlayer";
import { StudyChatDrawer } from "@/components/StudyChatDrawer";
import { HighlightedSummary } from "@/components/HighlightedSummary";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { McqQuiz } from "@/components/McqQuiz";
import {
  exploreOutlineFromRpcPayload,
  exploreOutlineHasModules,
} from "@/lib/explore-course-outline";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { resolveMentoredModuleForMaterial } from "@/lib/study/resolve-mentored-module";
import { resolveResumeTarget } from "@/lib/study/resolve-resume-target";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { createClient } from "@/lib/supabase/server";
import {
  fetchExamGroupsForSidebar,
  fetchStudyMaterialForPublicExplore,
  fetchStudyMaterialsOutlineRowsForPublicExplore,
} from "@/lib/supabase/fetch-explore-study-material";
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
  }>;
};

export default async function ExploreStudyPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const sp = await searchParams;

  const moduleNum =
    typeof sp.module === "string" ? Number(sp.module) : Number.NaN;
  let initialModuleFromUrl = Number.isFinite(moduleNum)
    ? moduleNum
    : undefined;
  const materialId =
    typeof sp.material === "string" ? sp.material : undefined;

  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const studyPath = `/explore/${courseId}/study`;
  const studyQs = new URLSearchParams();
  if (typeof sp.material === "string" && UUID_RE.test(sp.material)) {
    studyQs.set("material", sp.material);
  }
  if (typeof sp.module === "string" && sp.module.trim().length > 0) {
    studyQs.set("module", sp.module.trim());
  }
  const studyNext =
    studyQs.toString().length > 0 ? `${studyPath}?${studyQs}` : studyPath;

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(studyNext)}`);
  }

  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, title, description")
    .eq("id", courseId)
    .eq("is_public", true)
    .maybeSingle();

  if (!courseRow) notFound();

  if (
    typeof materialId === "string" &&
    UUID_RE.test(materialId) &&
    initialModuleFromUrl == null
  ) {
    const resolved = await resolveMentoredModuleForMaterial(
      supabase,
      user.id,
      materialId
    );
    if (resolved != null) initialModuleFromUrl = resolved;
  }

  const studyBase = `/explore/${courseId}/study`;

  // Entry-point shortcut — when neither material nor module is in the
  // URL, drop the learner where they last left off. Without this, the
  // page used to grab whatever fetchStudyMaterialForPublicExplore picked
  // first (sort_order asc, then a created_at tiebreak), which felt
  // random as soon as the user had history elsewhere in the course.
  if (!materialId && initialModuleFromUrl == null) {
    const target = await resolveResumeTarget(supabase, courseRow.id, user.id);
    if (target) {
      const qs = new URLSearchParams();
      qs.set("material", target.materialId);
      if (target.moduleId != null) qs.set("module", String(target.moduleId));
      if (sp.mode === "learn") qs.set("mode", "learn");
      redirect(`${studyBase}?${qs.toString()}`);
    }
  }

  const { row: fetchedRow, error: fetchErr } =
    await fetchStudyMaterialForPublicExplore(supabase, courseRow.id, materialId);

  if (fetchErr) {
    console.error(fetchErr);
    redirect(studyBase);
  }

  const row = fetchedRow;

  let outlineHasModules = false;
  if (!row) {
    const { data: outlineRaw } = await supabase.rpc("explore_course_outline", {
      p_course_id: courseId,
    });
    outlineHasModules = exploreOutlineHasModules(
      exploreOutlineFromRpcPayload(outlineRaw)
    );
  }

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

  if (!row) {
    return (
      <>
        <AppHeader right={headerRight} />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {outlineHasModules
              ? "Study content is not available yet"
              : "No generated course yet"}
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {outlineHasModules ? (
              <>
                This listing shows a course outline, but learners can&apos;t read
                the study files yet. The project owner should run{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                  supabase/migrations/013_public_study_read.sql
                </code>{" "}
                in the Supabase SQL Editor (or set{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                  SUPABASE_SERVICE_ROLE_KEY
                </code>{" "}
                on the server so Explore study can load public materials).
              </>
            ) : (
              <>This listing doesn&apos;t have study content yet.</>
            )}
          </p>
          <Link
            href={`/explore/${courseId}`}
            className="mt-6 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Back to course overview
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
    const [examGroups, allMaterials] = await Promise.all([
      fetchExamGroupsForSidebar(supabase, courseRow.id),
      fetchStudyMaterialsOutlineRowsForPublicExplore(supabase, courseRow.id),
    ]);

    const examGroupTabOrder = examGroups.map((g) => g.id);
    const examGroupNameById = new Map(examGroups.map((g) => [g.id, g.name]));

    const outlineCandidates = allMaterials
      .filter((r) => {
        const p = r.course_payload as CoursePayload | null;
        return Boolean(p?.modules?.length);
      })
      .map((r) => ({
        ...r,
        exam_group_id: r.exam_group_id ?? "",
      }));

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
      const egId = typeof r.exam_group_id === "string" && r.exam_group_id ? r.exam_group_id : undefined;
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
    return (
      <>
        <AppHeader right={headerRight} />
        <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
          <p className="mx-auto max-w-7xl text-xs text-zinc-500">
            <Link
              href={`/explore/${courseId}`}
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
          studyHrefBase={studyBase}
          courseManageEnabled={false}
        />
      </>
    );
  }

  if (hasLegacy) {
    const keyConcepts = row.key_concepts ?? [];
    return (
      <>
        <AppHeader right={headerRight} />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Legacy study pack
          </p>
          <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
            <Link
              href={`/explore/${courseId}`}
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
            studyHrefBase={`/explore/${courseId}/study`}
            docked
            variant="legacy"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader right={headerRight} />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Could not load course content
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Try again later or contact the creator.
        </p>
        <Link
          href={`/explore/${courseId}`}
          className="mt-6 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Back to overview
        </Link>
      </main>
    </>
  );
}
