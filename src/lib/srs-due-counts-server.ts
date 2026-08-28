import type { SupabaseClient } from "@supabase/supabase-js";
import type { SrsDueCounts } from "@/lib/srs-due";
import {
  isNotesFocusBucketId,
  NOTES_FOCUS_BUCKET_ID,
} from "@/lib/notes/notes-focus-bucket";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

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

function normId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase();
}

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

function ensureNotesBucket(
  byMaterial: Map<string, SrsDueCounts["byMaterial"][number]>,
  label: string | null
): SrsDueCounts["byMaterial"][number] {
  let bucket = byMaterial.get(NOTES_FOCUS_BUCKET_ID);
  if (!bucket) {
    bucket = {
      materialId: NOTES_FOCUS_BUCKET_ID,
      fileName: label || "Focus questions",
      courseId: null,
      courseTitle: "Notes",
      module: 0,
      personal: 0,
      total: 0,
    };
    byMaterial.set(NOTES_FOCUS_BUCKET_ID, bucket);
  } else if (label && bucket.fileName === "Focus questions") {
    bucket.fileName = label;
  }
  return bucket;
}

function ensureBucket(
  byMaterial: Map<string, SrsDueCounts["byMaterial"][number]>,
  materialId: string,
  meta?: MaterialRow | null
): SrsDueCounts["byMaterial"][number] {
  const key = normId(materialId);
  let bucket = byMaterial.get(key);
  if (!bucket) {
    bucket = {
      materialId: meta?.id ?? materialId,
      fileName: meta?.file_name ?? "Focus cards",
      courseId: meta ? deriveCourseId(meta) : null,
      courseTitle: meta ? deriveCourseTitle(meta) : null,
      module: 0,
      personal: 0,
      total: 0,
    };
    byMaterial.set(key, bucket);
  }
  return bucket;
}

/** Server-side due-card rollup — shared by the API route and nav SSR. */
export async function fetchSrsDueCountsForUser(
  supabase: SupabaseClient,
  userId: string,
  materialId?: string | null
): Promise<SrsDueCounts> {
  const materialFilter =
    materialId && UUID_RE.test(normId(materialId))
      ? normId(materialId)
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
    ensureBucket(byMaterial, m.id, m);
  }

  let modQ = supabase
    .from("user_module_card_srs")
    .select("material_id")
    .eq("user_id", userId)
    .lte("due_at", nowIso);
  if (materialFilter) modQ = modQ.eq("material_id", materialFilter);
  const { data: modRows } = await modQ;
  for (const row of modRows ?? []) {
    const bucket = byMaterial.get(normId(row.material_id as string));
    if (bucket) bucket.module += 1;
  }

  let perQ = supabase
    .from("user_personal_quiz_items")
    .select("material_id, source_label")
    .eq("user_id", userId)
    .lte("due_at", nowIso);
  if (materialFilter) perQ = perQ.eq("material_id", materialFilter);
  let { data: perRows, error: perErr } = await perQ;
  if (perErr && isMissingDbColumnError(perErr, "source_label")) {
    let fallback = supabase
      .from("user_personal_quiz_items")
      .select("material_id")
      .eq("user_id", userId)
      .lte("due_at", nowIso);
    if (materialFilter) fallback = fallback.eq("material_id", materialFilter);
    ({ data: perRows, error: perErr } = await fallback);
  }
  if (perErr) {
    console.error("[srs due counts personal]", perErr);
    perRows = [];
  }

  // Personal focus cards can sit on materials the user doesn't own (Explore /
  // shared / legacy). Hydrate those materials so due counts aren't silently 0.
  const missingIds = new Set<string>();
  for (const row of perRows ?? []) {
    const mid = row.material_id
      ? normId(row.material_id as string)
      : NOTES_FOCUS_BUCKET_ID;
    if (mid && !isNotesFocusBucketId(mid) && !byMaterial.has(mid)) {
      missingIds.add(mid);
    }
  }
  if (missingIds.size > 0) {
    const { data: extraMats } = await supabase
      .from("study_materials")
      .select("id, file_name, course_id, courses ( id, title )")
      .in("id", [...missingIds]);
    for (const raw of extraMats ?? []) {
      const m = raw as unknown as MaterialRow;
      ensureBucket(byMaterial, m.id, m);
    }
  }

  for (const row of perRows ?? []) {
    const mid = row.material_id
      ? normId(row.material_id as string)
      : NOTES_FOCUS_BUCKET_ID;
    const label =
      typeof row.source_label === "string" && row.source_label.trim()
        ? row.source_label.trim()
        : null;
    const bucket = isNotesFocusBucketId(mid)
      ? ensureNotesBucket(byMaterial, label)
      : ensureBucket(byMaterial, mid, null);
    bucket.personal += 1;
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
