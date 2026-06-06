import { NextResponse } from "next/server";

/**
 * POST /api/mentored/image — DISABLED.
 *
 * Wikimedia images have been removed from Mentored Learning. This
 * endpoint now always responds with `{ image: null }` (including for
 * any previously-cached results) so no web image is ever shown. The
 * client no longer calls it; it's kept only to avoid 404s from older
 * sessions still in the wild.
 */
export async function POST() {
  return NextResponse.json({ image: null, rateLimited: false });
}
