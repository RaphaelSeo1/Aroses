import { NextResponse } from "next/server";
import {
  COLLAB_UUID_RE,
  jsonError,
  requireCollaboratorManage,
} from "@/lib/collaboration/api-guards";
import { enrichCollaboratorRows } from "@/lib/collaboration/serialize-collaborators";
import type { CollaboratorRole } from "@/lib/collaboration/types";
import { createClient } from "@/lib/supabase/server";

type Params = {
  params: Promise<{ courseId: string; collaboratorId: string }>;
};

const EDITABLE_ROLES = new Set<CollaboratorRole>(["editor", "viewer"]);

/** PATCH — change role (owner) or leave course (non-owner). */
export async function PATCH(request: Request, ctx: Params) {
  const { courseId, collaboratorId } = await ctx.params;
  if (!COLLAB_UUID_RE.test(courseId) || !COLLAB_UUID_RE.test(collaboratorId)) {
    return jsonError("Invalid id.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON.", 400);
  }

  const b = body as { role?: unknown; action?: unknown };
  const now = new Date().toISOString();

  const { data: row } = await supabase
    .from("course_collaborators")
    .select("id, course_id, user_id, role, status")
    .eq("id", collaboratorId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (!row) return jsonError("Collaborator not found.", 404);

  if (b.action === "leave") {
    if (row.user_id !== user.id) {
      return jsonError("You can only leave your own membership.", 403);
    }
    if (row.role === "owner") {
      return jsonError(
        "Transfer ownership before leaving this course.",
        409
      );
    }
    const { error } = await supabase
      .from("course_collaborators")
      .update({ status: "revoked", updated_at: now })
      .eq("id", collaboratorId);
    if (error) {
      console.error("[collaborators PATCH leave]", error);
      return jsonError("Could not leave course.", 500);
    }
    return NextResponse.json({ ok: true });
  }

  const access = await requireCollaboratorManage(supabase, user.id, courseId);
  if (access instanceof NextResponse) return access;

  if (row.role === "owner") {
    return jsonError("Cannot change the owner role here. Use transfer ownership.", 400);
  }

  const role =
    typeof b.role === "string" && EDITABLE_ROLES.has(b.role as CollaboratorRole)
      ? (b.role as CollaboratorRole)
      : null;

  if (!role) return jsonError("Invalid role.", 400);

  const { data: updated, error } = await supabase
    .from("course_collaborators")
    .update({ role, updated_at: now })
    .eq("id", collaboratorId)
    .select(
      "id, course_id, user_id, invited_email, role, status, invited_by, created_at, updated_at, accepted_at"
    )
    .single();

  if (error) {
    console.error("[collaborators PATCH role]", error);
    return jsonError("Could not update role.", 500);
  }

  const [item] = await enrichCollaboratorRows(supabase, [updated]);
  return NextResponse.json({ collaborator: item });
}

/** DELETE — revoke invite or remove collaborator (owner only). */
export async function DELETE(_request: Request, ctx: Params) {
  const { courseId, collaboratorId } = await ctx.params;
  if (!COLLAB_UUID_RE.test(courseId) || !COLLAB_UUID_RE.test(collaboratorId)) {
    return jsonError("Invalid id.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized.", 401);

  const access = await requireCollaboratorManage(supabase, user.id, courseId);
  if (access instanceof NextResponse) return access;

  const { data: row } = await supabase
    .from("course_collaborators")
    .select("id, role")
    .eq("id", collaboratorId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (!row) return jsonError("Collaborator not found.", 404);
  if (row.role === "owner") {
    return jsonError("Cannot remove the course owner.", 400);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("course_collaborators")
    .update({ status: "revoked", updated_at: now })
    .eq("id", collaboratorId);

  if (error) {
    console.error("[collaborators DELETE]", error);
    return jsonError("Could not remove collaborator.", 500);
  }

  return NextResponse.json({ ok: true });
}
