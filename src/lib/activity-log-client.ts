/**
 * Report a client-only audit event (e.g. logging in or out) to the server.
 *
 * Fire-and-forget and fail-silent: auditing must never block or break the
 * user's actual action. The server validates the event type and takes the
 * actor from the verified session, so the only thing the browser sends is the
 * event name. `keepalive` lets the request survive a navigation/tab close
 * (important for sign-out, which immediately redirects).
 */
export async function reportClientActivity(
  type: "sign_in" | "sign_out"
): Promise<void> {
  try {
    await fetch("/api/activity/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
      keepalive: true,
      cache: "no-store",
    });
  } catch {
    // ignore — auditing is best-effort
  }
}
