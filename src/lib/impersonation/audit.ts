import "server-only";
import { logActivity } from "@/lib/activity-log";
import { createAdminClient } from "@/lib/supabase/admin";

export type ImpersonationAuditAction = "start" | "stop";

/**
 * Required audit trail: dedicated table plus the admin activity timeline.
 * Fail-open so a logging outage cannot trap an admin in view-as.
 */
export async function logImpersonationAudit(input: {
  action: ImpersonationAuditAction;
  adminUserId: string;
  adminEmail: string | null;
  targetUserId: string;
  targetEmail: string;
}): Promise<void> {
  const admin = createAdminClient();
  const targetEmail = input.targetEmail.trim().toLowerCase();
  const adminEmail = input.adminEmail?.trim().toLowerCase() || null;

  if (admin) {
    const { error } = await admin.from("admin_impersonation_audit").insert({
      admin_user_id: input.adminUserId,
      admin_email: adminEmail,
      target_user_id: input.targetUserId,
      target_email: targetEmail,
      action: input.action,
    });
    if (error) {
      console.warn("[impersonation-audit] insert failed", error.message);
    }
  }

  await logActivity(
    {
      userId: input.adminUserId,
      type:
        input.action === "start"
          ? "impersonation_started"
          : "impersonation_ended",
      summary: `${adminEmail ?? input.adminUserId} ${
        input.action === "start" ? "viewed as" : "stopped viewing"
      } ${targetEmail}`,
      metadata: {
        admin_user_id: input.adminUserId,
        admin_email: adminEmail,
        target_user_id: input.targetUserId,
        target_email: targetEmail,
        action: input.action,
      },
    },
    admin
  );
}
