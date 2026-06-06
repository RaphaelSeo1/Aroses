import { NextResponse } from "next/server";

/**
 * POST /api/tutor-session/[sessionId]/image — DISABLED.
 *
 * Wikimedia images have been removed from tutor sessions. This endpoint
 * now always responds with `{ image: null }` (including for any
 * previously-cached results) so no web image is ever shown.
 */
export async function POST() {
  return NextResponse.json({ image: null, rateLimited: false });
}
