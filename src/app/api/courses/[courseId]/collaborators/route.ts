import { NextResponse } from "next/server";
import {
  COLLAB_UUID_RE,
  jsonError,
  requireCollaboratorManage,
  requireCourseView,
} from "@/lib/collaboration/api-guards";
import { lookupUserIdByEmail } from "@/lib/collaboration/lookup-user-by-email";
import { enrichCollaboratorRows } from "@/lib/collaboration/serialize-collaborators";
import type { CollaboratorRole } from "@/lib/collaboration/types";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ courseId: string }> };

const INVITE_ROLES = new Set<CollaboratorRole>(["editor", "viewer"]);

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function missingCollaboratorsTable(error: { code?: string; message?: string }) {
  const msg = error.message ?? "";
  return (
    error.code === "42P01" ||
    msg.includes("course_collaborators") ||
    msg.includes("schema cache")
  );
}

/** GET — list collaborators for a course workspace. */
export async function GET(_request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!COLLAB_UUID_RE.test(courseId)) {
    return jsonError("Invalid course id.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized.", 401);

  const access = await requireCourseView(supabase, user.id, courseId);
  if (access instanceof NextResponse) return access;

  const { data, error } = await supabase
    .from("course_collaborators")
    .select(
      "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
    )
    .eq("course_id", courseId)
    .neq("status", "declined")
    .order("created_at", { ascending: true });

  if (error) {
    if (missingCollaboratorsTable(error)) {
      return NextResponse.json({ collaborators: [], viewerRole: access.role });
    }
    console.error("[collaborators GET]", error);
    return jsonError("Could not load collaborators.", 500);
  }

  const collaborators = await enrichCollaboratorRows(supabase, data ?? []);
  return NextResponse.json({
    collaborators,
    viewerRole: access.role,
    canManage: access.canManageCollaborators,
  });
}

/** POST — invite someone by email. */
export async function POST(request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!COLLAB_UUID_RE.test(courseId)) {
    return jsonError("Invalid course id.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized.", 401);

  const access = await requireCollaboratorManage(supabase, user.id, courseId);
  if (access instanceof NextResponse) return access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON.", 400);
  }

  const b = body as { email?: unknown; userId?: unknown; role?: unknown };

  const friendUserId =
    typeof b.userId === "string" && COLLAB_UUID_RE.test(b.userId) ? b.userId : null;

  if (friendUserId) {
    const { data: areFriends } = await supabase.rpc("users_are_friends", {
      p_user_id: user.id,
      p_other_id: friendUserId,
    });
    if (!areFriends) {
      return jsonError("You can only invite accepted friends this way.", 403);
    }

    const role =
      typeof b.role === "string" && INVITE_ROLES.has(b.role as CollaboratorRole)
        ? (b.role as CollaboratorRole)
        : "viewer";

    const { data: existing } = await supabase
      .from("course_collaborators")
      .select("id, role, status")
      .eq("course_id", courseId)
      .eq("user_id", friendUserId)
      .maybeSingle();

    if (existing?.status === "accepted") {
      return jsonError("This friend is already a collaborator.", 409);
    }
    if (existing?.status === "pending") {
      return jsonError("This friend already has a pending invite.", 409);
    }

    const now = new Date().toISOString();
    if (existing) {
      const { data: revived, error: reviveErr } = await supabase
        .from("course_collaborators")
        .update({
          role,
          status: "pending",
          invited_by: user.id,
          accepted_at: null,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select(
          "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
        )
        .single();
      if (reviveErr) return jsonError("Could not invite friend.", 500);
      const [item] = await enrichCollaboratorRows(supabase, [revived]);
      return NextResponse.json({ collaborator: item });
    }

    const { data: created, error } = await supabase
      .from("course_collaborators")
      .insert({
        course_id: courseId,
        user_id: friendUserId,
        role,
        status: "pending",
        invited_by: user.id,
        created_at: now,
        updated_at: now,
      })
      .select(
        "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
      )
      .single();

    if (error) {
      console.error("[collaborators POST friend]", error);
      return jsonError("Could not invite friend.", 500);
    }
    const [item] = await enrichCollaboratorRows(supabase, [created]);
    return NextResponse.json({ collaborator: item });
  }

  const email = typeof b.email === "string" ? normalizeEmail(b.email) : "";
  const role =
    typeof b.role === "string" && INVITE_ROLES.has(b.role as CollaboratorRole)
      ? (b.role as CollaboratorRole)
      : "viewer";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("Enter a valid email address.", 400);
  }

  if (user.email && normalizeEmail(user.email) === email) {
    return jsonError("You cannot invite yourself.", 400);
  }

  const { data: course } = await supabase
    .from("courses")
    .select("user_id")
    .eq("id", courseId)
    .maybeSingle();

  if (course?.user_id) {
    const ownerId = await lookupUserIdByEmail(email);
    if (ownerId && ownerId === course.user_id) {
      return jsonError("This person is already the course owner.", 400);
    }
  }

  const inviteeUserId = await lookupUserIdByEmail(email);
  const now = new Date().toISOString();

  if (inviteeUserId) {
    const { data: existing } = await supabase
      .from("course_collaborators")
      .select("id, role, status")
      .eq("course_id", courseId)
      .eq("user_id", inviteeUserId)
      .maybeSingle();

    if (existing) {
      if (existing.status === "accepted") {
        return jsonError(
          `${email} is already a collaborator (${existing.role}).`,
          409
        );
      }
      if (existing.status === "pending") {
        return jsonError(`${email} already has a pending invite.`, 409);
      }

      const { data: revived, error: reviveErr } = await supabase
        .from("course_collaborators")
        .update({
          role,
          status: "pending",
          invited_email: email,
          invited_by: user.id,
          accepted_at: null,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select(
          "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
        )
        .single();

      if (reviveErr) {
        console.error("[collaborators POST revive]", reviveErr);
        return jsonError("Could not re-invite collaborator.", 500);
      }

      const [item] = await enrichCollaboratorRows(supabase, [revived]);
      return NextResponse.json({
        collaborator: item,
        emailDelivery: "TODO",
      });
    }
  } else {
    const { data: pendingEmail } = await supabase
      .from("course_collaborators")
      .select("id, status")
      .eq("course_id", courseId)
      .ilike("invited_email", email)
      .maybeSingle();

    if (pendingEmail?.status === "pending") {
      return jsonError(`${email} already has a pending invite.`, 409);
    }
    if (pendingEmail?.status === "accepted") {
      return jsonError(`${email} is already a collaborator.`, 409);
    }
  }

  const { data: created, error } = await supabase
    .from("course_collaborators")
    .insert({
      course_id: courseId,
      user_id: inviteeUserId,
      invited_email: email,
      role,
      status: "pending",
      invited_by: user.id,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
    )
    .single();

  if (error) {
    if (missingCollaboratorsTable(error)) {
      return jsonError(
        "Collaboration is not enabled yet — run migration 059.",
        503
      );
    }
    console.error("[collaborators POST]", error);
    return jsonError("Could not send invite.", 500);
  }

  const [item] = await enrichCollaboratorRows(supabase, [created]);
  return NextResponse.json({
    collaborator: item,
    emailDelivery: "TODO",
  });
}
