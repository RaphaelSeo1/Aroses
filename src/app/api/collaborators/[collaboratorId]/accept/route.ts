import { NextResponse } from "next/server";
import { COLLAB_UUID_RE, jsonError } from "@/lib/collaboration/api-guards";
import { linkPendingInvitesForUser } from "@/lib/collaboration/link-pending-invites";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ collaboratorId: string }> };

/** POST — accept a pending course invite. */
export async function POST(_request: Request, ctx: Params) {
  const { collaboratorId } = await ctx.params;
  if (!COLLAB_UUID_RE.test(collaboratorId)) {
    return jsonError("Invalid invite id.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized.", 401);

  await linkPendingInvitesForUser(user.id, user.email);

  const { data: row } = await supabase
    .from("course_collaborators")
    .select("id, user_id, invited_email, status, role")
    .eq("id", collaboratorId)
    .maybeSingle();

  if (!row || row.status !== "pending") {
    return jsonError("Invite not found or already handled.", 404);
  }

  const email = user.email?.trim().toLowerCase() ?? "";
  const invitedEmail = row.invited_email?.trim().toLowerCase() ?? "";
  const isRecipient =
    row.user_id === user.id ||
    (!row.user_id && email.length > 0 && invitedEmail === email);

  if (!isRecipient) {
    return jsonError("This invite is not for your account.", 403);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("course_collaborators")
    .update({
      user_id: user.id,
      status: "accepted",
      accepted_at: now,
      updated_at: now,
    })
    .eq("id", collaboratorId);

  if (error) {
    console.error("[collaborators accept]", error);
    return jsonError("Could not accept invite.", 500);
  }

  return NextResponse.json({ ok: true });
}
