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

/** Loads cross-course progress for **courses you own** (profile Progress tab). */
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

  const courses =
    courseRows?.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
    })) ?? [];

  const courseIds = courses.map((c) => c.id);

  const { data: materialsRaw } =
    courseIds.length > 0
      ? await supabase
          .from("study_materials")
          .select("id, course_id, file_name, course_payload")
          .in("course_id", courseIds)
      : { data: [] };

  const { data: completionsRaw } = await supabase
    .from("module_completion")
    .select("material_id, module_id");

  const { data: attemptsRaw } = await supabase
    .from("question_attempts")
    .select("material_id, is_correct");

  const since = new Date();
  since.setDate(since.getDate() - 20);
  const { data: recentAnswered } = await supabase
    .from("question_attempts")
    .select("answered_at")
    .gte("answered_at", since.toISOString());

  const { courses: summaries, global } = buildCourseSummaries({
    courses,
    materials: materialsRaw ?? [],
    completions: completionsRaw ?? [],
    attempts: attemptsRaw ?? [],
  });

  const activityBuckets = bucketAttemptsLastDays(
    (recentAnswered ?? []).map((r) => r.answered_at),
    14
  );

  return {
    hasCourses: courses.length > 0,
    summaries,
    global,
    activityBuckets,
    dayLabels: last14DayLabels(),
  };
}
