import type { SupabaseClient } from "@supabase/supabase-js";
import type { CourseContentLocale } from "@/lib/course-canonical";
import { parseCoursePayload } from "@/lib/ai/course-payload";
import type { CoursePayload } from "@/types/course";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

export type SiblingCanonicalMaterial = {
  id: string;
  canonical_payload: CoursePayload;
  base_locale: CourseContentLocale;
};

/** Another upload in this course with the same source fingerprint and canonical JSON. */
export async function findSiblingCanonicalMaterial(
  admin: SupabaseClient,
  courseId: string,
  contentSourceKey: string
): Promise<SiblingCanonicalMaterial | null> {
  if (!contentSourceKey.trim()) return null;

  const { data, error } = await admin
    .from("study_materials")
    .select("id, canonical_payload, base_locale")
    .eq("course_id", courseId)
    .eq("content_source_key", contentSourceKey)
    .not("canonical_payload", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (
      isMissingDbColumnError(
        error,
        "canonical_payload",
        "base_locale",
        "content_source_key"
      )
    ) {
      return null;
    }
    console.warn("[study-material-canonical] sibling lookup failed", error);
    return null;
  }

  if (!data?.canonical_payload) return null;

  try {
    const canonical_payload = parseCoursePayload(data.canonical_payload);
    const rawLocale = (data as { base_locale?: unknown }).base_locale;
    const base_locale: CourseContentLocale =
      rawLocale === "ko" ? "ko" : "en";
    return {
      id: data.id as string,
      canonical_payload,
      base_locale,
    };
  } catch {
    return null;
  }
}
