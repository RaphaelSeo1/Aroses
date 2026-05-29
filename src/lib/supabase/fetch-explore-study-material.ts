import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

export type ExploreStudyMaterialRow = {
  id: string;
  summary: string;
  key_concepts: string[] | null;
  questions: unknown;
  course_id: string;
  file_name: string;
  course_payload: unknown | null;
  ingest_media?: unknown | null;
};

const SELECT_BASE =
  "id, summary, key_concepts, questions, course_id, file_name, course_payload";

async function selectMaterial(
  client: SupabaseClient,
  courseId: string,
  materialId?: string | null
) {
  const run = (columns: string) => {
    if (materialId) {
      return client
        .from("study_materials")
        .select(columns)
        .eq("id", materialId)
        .eq("course_id", courseId)
        .maybeSingle();
    }
    return client
      .from("study_materials")
      .select(columns)
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  };

  let result = await run(`${SELECT_BASE}, ingest_media`);
  if (result.error && isMissingDbColumnError(result.error, "ingest_media")) {
    result = await run(SELECT_BASE);
  }
  return result;
}

/**
 * Loads study material for `/explore/[id]/study`.
 *
 * The Explore outline RPC uses SECURITY DEFINER and can show structure even when
 * RLS still blocks `study_materials` for anon users (missing migration 013). We
 * try the session client first, then — only for this verified public course id —
 * the service-role client if configured.
 */
export async function fetchStudyMaterialForPublicExplore(
  supabase: SupabaseClient,
  courseId: string,
  materialId?: string | null
): Promise<{
  row: ExploreStudyMaterialRow | null;
  error: { message: string } | null;
}> {
  const primary = await selectMaterial(supabase, courseId, materialId);
  if (primary.error) {
    return { row: null, error: primary.error };
  }
  if (primary.data) {
    return { row: primary.data as unknown as ExploreStudyMaterialRow, error: null };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { row: null, error: null };
  }

  const fb = await selectMaterial(admin, courseId, materialId);
  if (fb.error) {
    console.error(fb.error);
    return { row: null, error: fb.error };
  }
  return {
    row: (fb.data as unknown as ExploreStudyMaterialRow) ?? null,
    error: null,
  };
}

const MATERIAL_OUTLINE_SELECT =
  "id, file_name, course_payload, exam_group_id, sort_order, created_at";

export type ExploreStudyMaterialOutlineRow = {
  id: string;
  file_name: string;
  course_payload: unknown;
  exam_group_id: string | null;
  sort_order: number;
  created_at: string;
};

/** All materials for sidebar ordering on Explore study (RLS or admin fallback). */
export async function fetchStudyMaterialsOutlineRowsForPublicExplore(
  supabase: SupabaseClient,
  courseId: string
): Promise<ExploreStudyMaterialOutlineRow[]> {
  const run = (client: SupabaseClient) =>
    client
      .from("study_materials")
      .select(MATERIAL_OUTLINE_SELECT)
      .eq("course_id", courseId);

  const { data, error } = await run(supabase);
  if (error) {
    console.error(error);
    return [];
  }
  const rows = (data ?? []) as ExploreStudyMaterialOutlineRow[];
  if (rows.length > 0) return rows;

  const admin = createAdminClient();
  if (!admin) return [];

  const { data: ad, error: ae } = await run(admin);
  if (ae) {
    console.error(ae);
    return [];
  }
  return (ad ?? []) as ExploreStudyMaterialOutlineRow[];
}

/** Section order for sorting materials (RLS or admin fallback). */
export async function fetchExamGroupIdsOrderForPublicExplore(
  supabase: SupabaseClient,
  courseId: string
): Promise<string[]> {
  const groups = await fetchExamGroupsForSidebar(supabase, courseId);
  return groups.map((g) => g.id);
}

/** Ordered exam groups with names for sidebar section headers (RLS or admin fallback). */
export async function fetchExamGroupsForSidebar(
  supabase: SupabaseClient,
  courseId: string
): Promise<{ id: string; name: string }[]> {
  const run = (client: SupabaseClient) =>
    client
      .from("exam_groups")
      .select("id, name")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

  const { data, error } = await run(supabase);
  if (error) {
    console.error(error);
    return [];
  }
  const rows = (data ?? []) as { id: string; name: string }[];
  if (rows.length > 0) return rows;

  const admin = createAdminClient();
  if (!admin) return [];

  const { data: ad, error: ae } = await run(admin);
  if (ae) {
    console.error(ae);
    return [];
  }
  return (ad ?? []) as { id: string; name: string }[];
}
