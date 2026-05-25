import type { SupabaseClient } from "@supabase/supabase-js";
import type { SrsDueCounts } from "@/lib/srs-due";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MaterialRow = {
  id: string;
  file_name: string | null;
  course_id: string | null;
  courses:
    | { id: string; title: string | null }
    | { id: string; title: string | null }[]
    | null;
};

function deriveCourseId(m: MaterialRow): string | null {
  if (m.course_id) return m.course_id;
  const c = m.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.id ?? null;
  return c.id ?? null;
}

function deriveCourseTitle(m: MaterialRow): string | null {
  const c = m.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.title ?? null;
  return c.title ?? null;
}

/** Server-side due-card rollup — shared by the API route and nav SSR. */
export async function fetchSrsDueCountsForUser(
  supabase: SupabaseClient,
  userId: string,
  materialId?: string | null
): Promise<SrsDueCounts> {
  const materialFilter =
    materialId && UUID_RE.test(materialId.toLowerCase())
      ? materialId.toLowerCase()
      : null;

  const nowIso = new Date().toISOString();

  let matsQuery = supabase
    .from("study_materials")
    .select("id, file_name, course_id, courses ( id, title )")
    .eq("user_id", userId);
  if (materialFilter) matsQuery = matsQuery.eq("id", materialFilter);
  const { data: matsRaw } = await matsQuery;

  const materials = (matsRaw ?? []) as unknown as MaterialRow[];

  const byMaterial = new Map<
    string,
    SrsDueCounts["byMaterial"][number]
  >();
  for (const m of materials) {
    byMaterial.set(m.id, {
      materialId: m.id,
      fileName: m.file_name ?? "Untitled upload",
      courseId: deriveCourseId(m),
      courseTitle: deriveCourseTitle(m),
      module: 0,
      personal: 0,
      total: 0,
    });
  }

  let modQ = supabase
    .from("user_module_card_srs")
    .select("material_id")
    .eq("user_id", userId)
    .lte("due_at", nowIso);
  if (materialFilter) modQ = modQ.eq("material_id", materialFilter);
  const { data: modRows } = await modQ;
  for (const row of modRows ?? []) {
    const bucket = byMaterial.get(row.material_id as string);
    if (bucket) bucket.module += 1;
  }

  let perQ = supabase
    .from("user_personal_quiz_items")
    .select("material_id")
    .eq("user_id", userId)
    .lte("due_at", nowIso);
  if (materialFilter) perQ = perQ.eq("material_id", materialFilter);
  const { data: perRows } = await perQ;
  for (const row of perRows ?? []) {
    const bucket = byMaterial.get(row.material_id as string);
    if (bucket) bucket.personal += 1;
  }

  let totalModule = 0;
  let totalPersonal = 0;
  for (const b of byMaterial.values()) {
    b.total = b.module + b.personal;
    totalModule += b.module;
    totalPersonal += b.personal;
  }

  return {
    total: totalModule + totalPersonal,
    module: totalModule,
    personal: totalPersonal,
    byMaterial: [...byMaterial.values()]
      .filter((b) => b.total > 0 || materialFilter)
      .sort((a, b) => b.total - a.total),
  };
}
