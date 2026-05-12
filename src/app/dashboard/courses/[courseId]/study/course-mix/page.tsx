import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CourseWorkspaceBackRow } from "@/components/CourseWorkspaceBackRow";
import { CourseMixQuizClient } from "@/components/CourseMixQuizClient";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";
import type { CourseWideQuizEntry } from "@/lib/quiz-session";

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

function collectEntries(
  materials: { id: string; course_payload: unknown }[]
): CourseWideQuizEntry[] {
  const out: CourseWideQuizEntry[] = [];
  for (const row of materials) {
    const p = row.course_payload as CoursePayload | null | undefined;
    if (!p?.modules?.length) continue;
    for (const mod of p.modules) {
      if (!mod.quiz?.length) continue;
      mod.quiz.forEach((question, quizIndex) => {
        out.push({
          materialId: row.id,
          moduleId: mod.id,
          quizIndex,
          question,
        });
      });
    }
  }
  return out;
}

export default async function CourseMixStudyPage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const { material: materialParam, module: moduleParam, mode: modeParam } =
    await searchParams;
  const learnMode = modeParam === "learn";

  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/study/course-mix`)}`
    );
  }

  const courseRow = await fetchCourseForDashboard(supabase, courseId, user.id);

  if (!courseRow) notFound();

  const courseTitle = courseRow.title?.trim() || "Course";

  const { data: groupsOrder } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("course_id", courseRow.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const examGroupTabOrder = (groupsOrder ?? []).map((g) => g.id);

  const { data: allMaterials } = await supabase
    .from("study_materials")
    .select("id, file_name, course_payload, exam_group_id, sort_order, created_at")
    .eq("course_id", courseRow.id);

  const outlineCandidates = (allMaterials ?? []).filter((r) => {
    const p = r.course_payload as CoursePayload | null;
    return Boolean(p?.modules?.length);
  });

  const outlineRows = sortStudyMaterialsForDashboard(
    outlineCandidates,
    examGroupTabOrder
  );

  const entries = collectEntries(outlineRows);

  const moduleNum =
    typeof moduleParam === "string" ? Number(moduleParam) : Number.NaN;
  const safeModule = Number.isFinite(moduleNum) ? moduleNum : 1;

  const backQs = new URLSearchParams();
  if (typeof materialParam === "string" && UUID_RE.test(materialParam)) {
    backQs.set("material", materialParam);
  } else if (outlineRows[0]?.id) {
    backQs.set("material", outlineRows[0].id);
  }
  backQs.set("module", String(safeModule));
  if (learnMode) backQs.set("mode", "learn");
  const returnHref = `/dashboard/courses/${courseId}/study/quiz?${backQs.toString()}`;

  const fallbackMaterialId =
    typeof materialParam === "string" && UUID_RE.test(materialParam)
      ? materialParam
      : outlineRows[0]?.id ?? "";

  if (entries.length === 0 || !fallbackMaterialId) {
    redirect(returnHref);
  }

  const firstEntry = entries[0]!;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <CourseWorkspaceBackRow
        courseId={courseId}
        courseTitle={courseTitle}
      />
      <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="rounded-full bg-brand-blush px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink dark:bg-[#1e1616]/80 dark:text-brand-soft">
            Whole-course mix
          </span>
          <span className="text-zinc-400">·</span>
          <Link
            href={returnHref}
            className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
          >
            Back to practice
          </Link>
        </p>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-10">
        <header className="border-b border-zinc-100 pb-8 dark:border-zinc-900">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mixed review
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Up to 14 questions chosen at random from every module across all
            uploads in this course ({entries.length} bank questions total).
            Multiple runs reshuffle the draw; attempts still attach to each
            question&apos;s real module for stats.
          </p>
        </header>

        <div className="mt-10">
          <CourseMixQuizClient
            entries={entries}
            fallbackMaterialId={fallbackMaterialId}
            fallbackModuleId={firstEntry.moduleId}
            returnHref={returnHref}
          />
        </div>
      </main>
    </>
  );
}
