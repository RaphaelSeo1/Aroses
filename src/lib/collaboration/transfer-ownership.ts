import { createAdminClient } from "@/lib/supabase/admin";

/** Atomically transfer course ownership (service role). */
export async function transferCourseOwnership(
  courseId: string,
  fromUserId: string,
  toUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Server is not configured for ownership transfer." };
  }

  const now = new Date().toISOString();

  const { error: courseErr } = await admin
    .from("courses")
    .update({ user_id: toUserId })
    .eq("id", courseId)
    .eq("user_id", fromUserId);

  if (courseErr) {
    console.error("[transfer-ownership] courses", courseErr);
    return { ok: false, error: "Could not transfer course ownership." };
  }

  const { error: demoteErr } = await admin
    .from("course_collaborators")
    .update({ role: "editor", updated_at: now })
    .eq("course_id", courseId)
    .eq("user_id", fromUserId)
    .eq("role", "owner");

  if (demoteErr) {
    console.error("[transfer-ownership] demote", demoteErr);
    return { ok: false, error: "Could not update previous owner role." };
  }

  const { data: targetRow } = await admin
    .from("course_collaborators")
    .select("id")
    .eq("course_id", courseId)
    .eq("user_id", toUserId)
    .maybeSingle();

  if (targetRow) {
    const { error: promoteErr } = await admin
      .from("course_collaborators")
      .update({
        role: "owner",
        status: "accepted",
        accepted_at: now,
        updated_at: now,
      })
      .eq("id", targetRow.id);

    if (promoteErr) {
      console.error("[transfer-ownership] promote", promoteErr);
      return { ok: false, error: "Could not promote new owner." };
    }
  } else {
    const { error: insertErr } = await admin.from("course_collaborators").insert({
      course_id: courseId,
      user_id: toUserId,
      role: "owner",
      status: "accepted",
      invited_by: fromUserId,
      accepted_at: now,
      created_at: now,
      updated_at: now,
    });

    if (insertErr) {
      console.error("[transfer-ownership] insert owner row", insertErr);
      return { ok: false, error: "Could not create owner collaborator row." };
    }
  }

  return { ok: true };
}
