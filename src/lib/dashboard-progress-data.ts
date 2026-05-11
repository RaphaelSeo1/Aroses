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
  };
}
