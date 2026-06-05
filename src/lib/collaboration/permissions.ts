import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollaboratorRole, ViewerCourseRole } from "@/lib/collaboration/types";

export type CourseAccess = {
  courseId: string;
  ownerUserId: string;
  role: ViewerCourseRole;
  canView: boolean;
  canEditContent: boolean;
  canManageCollaborators: boolean;
  canDeleteCourse: boolean;
};

function accessFromRole(
  courseId: string,
  ownerUserId: string,
  role: CollaboratorRole | null,
  isDbOwner: boolean
): CourseAccess {
  const effectiveRole: ViewerCourseRole =
    role ?? (isDbOwner ? "owner" : null);

  const isOwner = isDbOwner || effectiveRole === "owner";
  const canView =
    isOwner ||
    effectiveRole === "editor" ||
    effectiveRole === "viewer";
  const canEditContent = isOwner || effectiveRole === "editor";

  return {
    courseId,
    ownerUserId,
    role: effectiveRole,
    canView,
    canEditContent,
    canManageCollaborators: isOwner,
    canDeleteCourse: isOwner,
  };
}

/** Resolve the signed-in user's access to a course workspace. */
export async function resolveCourseAccess(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<CourseAccess | null> {
  const { data: course } = await supabase
    .from("courses")
    .select("id, user_id")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return null;

  const isDbOwner = course.user_id === userId;
  if (isDbOwner) {
    return accessFromRole(courseId, course.user_id, "owner", true);
  }

  const { data: row } = await supabase
    .from("course_collaborators")
    .select("role, status")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row || row.status !== "accepted") {
    return null;
  }

  return accessFromRole(
    courseId,
    course.user_id,
    row.role as CollaboratorRole,
    false
  );
}

export async function canViewCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const access = await resolveCourseAccess(supabase, userId, courseId);
  return Boolean(access?.canView);
}

export async function canEditCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const access = await resolveCourseAccess(supabase, userId, courseId);
  return Boolean(access?.canEditContent);
}

export async function canManageCollaborators(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const access = await resolveCourseAccess(supabase, userId, courseId);
  return Boolean(access?.canManageCollaborators);
}

export async function resolveMaterialCourseId(
  supabase: SupabaseClient,
  materialId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("study_materials")
    .select("course_id")
    .eq("id", materialId)
    .maybeSingle();
  return data?.course_id ?? null;
}

export async function canEditStudyMaterial(
  supabase: SupabaseClient,
  userId: string,
  materialId: string
): Promise<boolean> {
  const courseId = await resolveMaterialCourseId(supabase, materialId);
  if (!courseId) return false;
  return canEditCourse(supabase, userId, courseId);
}

// TODO: real-time collaborative editing would hook in before content saves here.
