import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bucketAttemptsLastDays,
  buildCourseSummaries,
  type CourseLearningSummary,
  type GlobalLearningTotals,
} from "@/lib/learning-stats";

export type DashboardProgressPayload = {
  hasCourses: boolean;
  summaries: CourseLearningSummary[];
  global: GlobalLearningTotals;
  activityBuckets: number[];
  dayLabels: string[];
  recentPractice: {
    courseId: string;
    title: string;
    answeredAt: string;
    correctLast10: number;
    totalLast10: number;
    modulesCompleted: number;
    modulesTotal: number;
    isExploreLearner: boolean;
  }[];
};

function last14DayLabels(): string[] {
  const letters = ["S", "M", "T", "W", "T", "F", "S"];
  const out: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(letters[d.getDay()]);
  }
  return out;
}

function missingIsPublicColumn(err: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    /is_public|schema cache/i.test(err.message ?? "")
  );
}

/** Loads cross-course progress: **owned** courses plus any other course where you have module or quiz activity. */
export async function loadDashboardProgress(
  supabase: SupabaseClient,
  ownerUserId: string
): Promise<DashboardProgressPayload> {
  const primary = await supabase
    .from("courses")
    .select("id, title, description, created_at, sort_order, is_public")
    .eq("user_id", ownerUserId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const fallback =
    primary.error && missingIsPublicColumn(primary.error)
      ? await supabase
          .from("courses")
          .select("id, title, description, created_at, sort_order")
          .eq("user_id", ownerUserId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : null;

  const courseRows =
    fallback && !fallback.error ? fallback.data : primary.data;

  const ownedCourses =
    courseRows?.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
    })) ?? [];

  const ownedCourseIds = new Set(ownedCourses.map((c) => c.id));

  const { data: ownedMaterialsRaw } =
    ownedCourseIds.size > 0
      ? await supabase
          .from("study_materials")
          .select("id, course_id, file_name, course_payload")
          .in("course_id", [...ownedCourseIds])
      : { data: [] as { id: string; course_id: string; file_name: string; course_payload: unknown }[] };

  const { data: completionsRaw } = await supabase
    .from("module_completion")
    .select("material_id, module_id");

  const { data: attemptsRaw } = await supabase
    .from("question_attempts")
    .select("material_id, is_correct");

  const touchedMaterialIds = new Set<string>();
  for (const c of completionsRaw ?? []) {
    touchedMaterialIds.add(c.material_id);
  }
  for (const a of attemptsRaw ?? []) {
    touchedMaterialIds.add(a.material_id);
  }

  const knownMaterialIds = new Set(
    (ownedMaterialsRaw ?? []).map((m) => m.id)
  );
  const missingMaterialIds = [...touchedMaterialIds].filter(
    (id) => !knownMaterialIds.has(id)
  );

  let extraMaterials: {
    id: string;
    course_id: string;
    file_name: string;
    course_payload: unknown;
  }[] = [];

  if (missingMaterialIds.length > 0) {
    const { data: fetched } = await supabase
      .from("study_materials")
      .select("id, course_id, file_name, course_payload")
      .in("id", missingMaterialIds);
    extraMaterials = fetched ?? [];
  }

  const materialsById = new Map<
    string,
    {
      id: string;
      course_id: string;
      file_name: string;
      course_payload: unknown;
    }
  >();
  for (const m of ownedMaterialsRaw ?? []) {
    materialsById.set(m.id, m);
  }
  for (const m of extraMaterials) {
    materialsById.set(m.id, m);
  }
  const allMaterials = [...materialsById.values()];

  const learnerCourseIds = new Set<string>();
  for (const m of extraMaterials) {
    if (!ownedCourseIds.has(m.course_id)) {
      learnerCourseIds.add(m.course_id);
    }
  }

  let learnerCourses: { id: string; title: string; description: string | null }[] =
    [];
  if (learnerCourseIds.size > 0) {
    const { data: fetchedCourses } = await supabase
      .from("courses")
      .select("id, title, description")
      .in("id", [...learnerCourseIds]);
    learnerCourses = (fetchedCourses ?? []).slice().sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }

  const courses = [...ownedCourses, ...learnerCourses];

  const since = new Date();
  since.setDate(since.getDate() - 20);
  const { data: recentAnswered } = await supabase
    .from("question_attempts")
    .select("answered_at")
    .gte("answered_at", since.toISOString());

  const { data: recentAttemptsRaw } = await supabase
    .from("question_attempts")
    .select("material_id, is_correct, answered_at")
    .order("answered_at", { ascending: false })
    .limit(120);

  const recentMaterialIds = Array.from(
    new Set((recentAttemptsRaw ?? []).map((r) => r.material_id))
  ).slice(0, 80);

  const { data: recentMaterialsRaw } =
    recentMaterialIds.length > 0
      ? await supabase
          .from("study_materials")
          .select("id, course_id")
          .in("id", recentMaterialIds)
      : { data: [] as { id: string; course_id: string }[] };

  const courseIdByMaterialId = new Map<string, string>();
  const recentCourseIds = new Set<string>();
  for (const m of recentMaterialsRaw ?? []) {
    courseIdByMaterialId.set(m.id, m.course_id);
    recentCourseIds.add(m.course_id);
  }

  const { data: recentCourseRows } =
    recentCourseIds.size > 0
      ? await supabase
          .from("courses")
          .select("id, title")
          .in("id", [...recentCourseIds])
      : { data: [] as { id: string; title: string }[] };

  const courseTitleById = new Map<string, string>();
  for (const c of recentCourseRows ?? []) {
    courseTitleById.set(c.id, c.title);
  }

  const recentPracticeByCourse = new Map<
    string,
    {
      courseId: string;
      title: string;
      answeredAt: string;
      correctLast10: number;
      totalLast10: number;
    }
  >();

  for (const att of recentAttemptsRaw ?? []) {
    const courseId = courseIdByMaterialId.get(att.material_id);
    if (!courseId) continue;
    const title = courseTitleById.get(courseId) ?? "Course";
    const existing = recentPracticeByCourse.get(courseId);
    const base = existing ?? {
      courseId,
      title,
      answeredAt: att.answered_at,
      correctLast10: 0,
      totalLast10: 0,
    };

    if (base.totalLast10 >= 10) continue;
    const next = {
      ...base,
      totalLast10: base.totalLast10 + 1,
      correctLast10: base.correctLast10 + (att.is_correct ? 1 : 0),
    };
    recentPracticeByCourse.set(courseId, next);
  }

  const { courses: summariesRaw, global } = buildCourseSummaries({
    courses,
    materials: allMaterials,
    completions: completionsRaw ?? [],
    attempts: attemptsRaw ?? [],
  });

  const summaries = summariesRaw.map((s) => ({
    ...s,
    isExploreLearner: !ownedCourseIds.has(s.courseId),
  }));

  const summaryByCourseId = new Map<string, (typeof summaries)[number]>();
  for (const s of summaries) {
    summaryByCourseId.set(s.courseId, s);
  }

  const recentPractice = [...recentPracticeByCourse.values()]
    .sort(
      (a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime()
    )
    .slice(0, 8)
    .map((r) => {
      const s = summaryByCourseId.get(r.courseId);
      return {
        ...r,
        modulesCompleted: s?.modulesCompleted ?? 0,
        modulesTotal: s?.modulesTotal ?? 0,
        isExploreLearner: Boolean(s?.isExploreLearner),
      };
    });

  const activityBuckets = bucketAttemptsLastDays(
    (recentAnswered ?? []).map((r) => r.answered_at),
    14
  );

  const hasCourses = summaries.some(
    (s) =>
      s.uploadsCount > 0 ||
      s.quizAttempts > 0 ||
      s.modulesCompleted > 0
  );

  return {
    hasCourses,
    summaries,
    global,
    activityBuckets,
    dayLabels: last14DayLabels(),
    recentPractice,
  };
}
