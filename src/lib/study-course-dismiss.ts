import type { SupabaseClient } from "@supabase/supabase-js";

/** Course ids the learner removed from Continue studying / progress tiles. */
export async function loadDismissedStudyCourseIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("user_study_course_dismissed")
    .select("course_id")
    .eq("user_id", userId);

  if (error) {
    if (error.code === "42P01") {
      // Migration not applied yet — treat as empty.
      return new Set();
    }
    console.error("[study-course-dismiss] load", error);
    return new Set();
  }

  return new Set(
    (data ?? [])
      .map((row) => row.course_id)
      .filter((id): id is string => typeof id === "string")
  );
}

export async function dismissStudyCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const { error } = await supabase.from("user_study_course_dismissed").upsert(
    {
      user_id: userId,
      course_id: courseId,
      dismissed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,course_id" }
  );

  if (error) {
    console.error("[study-course-dismiss] upsert", error);
    return false;
  }
  return true;
}
