import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardCourse } from "@/components/CourseDashboardList";

export type StudyingCourse = {
  id: string;
  title: string;
  description: string | null;
};

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

function missingSelfStudyColumn(err: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    /is_self_study|schema cache/i.test(err.message ?? "")
  );
}

/**
 * Owned workspace courses plus public (or readable) courses the user has study
 * activity on without owning — shown on the home dashboard.
 */
export async function loadDashboardCourseLists(
  supabase: SupabaseClient,
  userId: string
): Promise<{ owned: DashboardCourse[]; studying: StudyingCourse[] }> {
  let primary = await supabase
    .from("courses")
    .select(
      "id, title, description, created_at, sort_order, is_public, is_self_study, user_id"
    )
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (primary.error && missingSelfStudyColumn(primary.error)) {
    primary = (await supabase
      .from("courses")
      .select(
        "id, title, description, created_at, sort_order, is_public, user_id"
      )
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })) as typeof primary;
  }

  const fallback =
    primary.error && missingIsPublicColumn(primary.error)
      ? await supabase
          .from("courses")
          .select("id, title, description, created_at, sort_order, user_id")
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : null;

  const rawOwned =
    fallback && !fallback.error ? fallback.data : primary.data;

  const owned: DashboardCourse[] = (rawOwned ?? [])
    .filter((row) => row.user_id === userId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      user_id: row.user_id,
      is_public: Boolean((row as { is_public?: boolean }).is_public),
      is_self_study: Boolean((row as { is_self_study?: boolean }).is_self_study),
    }));

  const ownedIds = new Set(owned.map((c) => c.id));

  const { data: ownedMaterialsRaw } =
    ownedIds.size > 0
      ? await supabase
          .from("study_materials")
          .select("id")
          .in("course_id", [...ownedIds])
      : { data: [] as { id: string }[] };

  const knownMaterialIds = new Set(
    (ownedMaterialsRaw ?? []).map((m) => m.id)
  );

  const { data: completionsRaw } = await supabase
    .from("module_completion")
    .select("material_id");

  const { data: attemptsRaw } = await supabase
    .from("question_attempts")
    .select("material_id");

  const touchedMaterialIds = new Set<string>();
  for (const c of completionsRaw ?? []) {
    touchedMaterialIds.add(c.material_id);
  }
  for (const a of attemptsRaw ?? []) {
    touchedMaterialIds.add(a.material_id);
  }

  const missingMaterialIds = [...touchedMaterialIds].filter(
    (id) => !knownMaterialIds.has(id)
  );

  let studying: StudyingCourse[] = [];

  if (missingMaterialIds.length > 0) {
    const { data: extraMaterials } = await supabase
      .from("study_materials")
      .select("course_id")
      .in("id", missingMaterialIds);

    const foreignCourseIds = new Set<string>();
    for (const m of extraMaterials ?? []) {
      if (!ownedIds.has(m.course_id)) {
        foreignCourseIds.add(m.course_id);
      }
    }

    if (foreignCourseIds.size > 0) {
      const { data: foreignRows } = await supabase
        .from("courses")
        .select("id, title, description")
        .in("id", [...foreignCourseIds]);

      studying = (foreignRows ?? [])
        .filter((r) => !ownedIds.has(r.id))
        .map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    }
  }

  return { owned, studying };
}
