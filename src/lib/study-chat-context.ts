import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudyCourseMapEntry } from "@/lib/ai/study-chat";
import type { CoursePayload } from "@/types/course";

export function buildCourseMapFromMaterials(
  materials: {
    id: string;
    course_payload: CoursePayload;
    label?: string | null;
  }[]
): StudyCourseMapEntry[] {
  const entries: StudyCourseMapEntry[] = [];
  for (const m of materials) {
    const payload = m.course_payload;
    if (!payload?.modules?.length) continue;
    entries.push({
      materialId: m.id,
      label:
        m.label?.trim() ||
        payload.title?.trim() ||
        `Upload ${entries.length + 1}`,
      modules: payload.modules.map((mod) => ({
        id: mod.id,
        title: mod.title,
        lessonTitles: mod.lessons.map((l) => l.title),
      })),
    });
  }
  return entries;
}

export async function fetchCourseMaterialsForChat(
  supabase: SupabaseClient,
  courseId: string,
  primaryMaterialId: string,
  primaryPayload: CoursePayload
): Promise<{ id: string; course_payload: CoursePayload; label: string }[]> {
  const materials: { id: string; course_payload: CoursePayload; label: string }[] =
    [
      {
        id: primaryMaterialId,
        course_payload: primaryPayload,
        label: primaryPayload.title?.trim() || "Current upload",
      },
    ];

  const { data: otherMats } = await (createAdminClient() ?? supabase)
    .from("study_materials")
    .select("id, course_payload, source_filename")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });

  for (const om of otherMats ?? []) {
    const row = om as {
      id?: string;
      course_payload?: CoursePayload | null;
      source_filename?: string | null;
    };
    if (!row.id || row.id === primaryMaterialId) continue;
    const pl = row.course_payload;
    if (!pl?.modules?.length) continue;
    materials.push({
      id: row.id,
      course_payload: pl,
      label:
        pl.title?.trim() ||
        row.source_filename?.trim() ||
        `Upload ${materials.length + 1}`,
    });
  }

  return materials;
}
