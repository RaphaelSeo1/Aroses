import { NextResponse } from "next/server";
import {
  COLLAB_UUID_RE,
  jsonError,
  requireCollaboratorManage,
} from "@/lib/collaboration/api-guards";
import { transferCourseOwnership } from "@/lib/collaboration/transfer-ownership";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ courseId: string }> };

/** POST — transfer ownership to an accepted collaborator. */
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

  const collaboratorId = (body as { collaboratorId?: unknown }).collaboratorId;
  if (typeof collaboratorId !== "string" || !COLLAB_UUID_RE.test(collaboratorId)) {
    return jsonError("Invalid collaborator id.", 400);
  }

  const { data: target } = await supabase
    .from("course_collaborators")
    .select("id, user_id, role, status")
    .eq("id", collaboratorId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (!target?.user_id) {
    return jsonError("Collaborator not found.", 404);
  }
  if (target.status !== "accepted") {
    return jsonError("Only accepted collaborators can become owner.", 400);
  }
  if (target.role === "owner" || target.user_id === user.id) {
    return jsonError("Pick a different collaborator to transfer to.", 400);
  }

  const result = await transferCourseOwnership(
    courseId,
    user.id,
    target.user_id
  );

  if (!result.ok) {
    return jsonError(result.error, 500);
  }

  return NextResponse.json({ ok: true });
}
