import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canEditCourse,
  canManageCollaborators,
  canViewCourse,
  resolveCourseAccess,
  type CourseAccess,
} from "@/lib/collaboration/permissions";

export const COLLAB_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireCourseView(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<CourseAccess | NextResponse> {
  const access = await resolveCourseAccess(supabase, userId, courseId);
  if (!access?.canView) {
    return jsonError("Course not found or you do not have access.", 403);
  }
  return access;
}

export async function requireCourseEdit(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<CourseAccess | NextResponse> {
  const access = await resolveCourseAccess(supabase, userId, courseId);
  if (!access?.canEditContent) {
    return jsonError("You do not have permission to edit this course.", 403);
  }
  return access;
}

export async function requireCollaboratorManage(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<CourseAccess | NextResponse> {
  const access = await resolveCourseAccess(supabase, userId, courseId);
  if (!access?.canManageCollaborators) {
    return jsonError("Only the course owner can manage collaborators.", 403);
  }
  return access;
}

export async function hasCourseEdit(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  return canEditCourse(supabase, userId, courseId);
}

export async function hasCourseView(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  return canViewCourse(supabase, userId, courseId);
}

export async function hasCollaboratorManage(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  return canManageCollaborators(supabase, userId, courseId);
}
