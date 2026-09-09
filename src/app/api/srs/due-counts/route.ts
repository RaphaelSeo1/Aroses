import { NextResponse } from "next/server";
import { isMissingAuthSessionError } from "@/lib/auth/public-routes";
import { fetchSrsDueCountsForUser } from "@/lib/srs-due-counts-server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/srs/due-counts
 *
 * Returns the number of cards due *right now* for the signed-in user,
 * grouped a few useful ways. This is the lightweight endpoint behind:
 *   - the global nav badge ("47" dot next to "Review")
 *   - the dashboard banner ("47 cards due for review today")
 *   - the per-course "Review N due" CTAs on the course page
 *
 * Query params:
 *   materialId=<uuid>   restrict counts to a single course/material
 *
 * Response:
 *   {
 *     total: number,                        // grand total
 *     module: number,                       // due module-bank cards
 *     personal: number,                     // due personal cards
 *     byMaterial: [{
 *       materialId, fileName, courseId, courseTitle,
 *       module, personal, total
 *     }]
 *   }
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient({ timeoutMs: 5_000 });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError && !isMissingAuthSessionError(authError)) {
    console.error("[srs/due-counts] auth unavailable:", authError.message);
    return NextResponse.json(
      { error: "Authentication service temporarily unavailable." },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  if (!user) {
    // Public callers (e.g. dashboard SSR before sign-in) get zero counts so
    // the badge silently disappears rather than 401-ing.
    return NextResponse.json({
      total: 0,
      module: 0,
      personal: 0,
      byMaterial: [],
    });
  }

  const url = new URL(request.url);
  const materialIdRaw = (url.searchParams.get("materialId") ?? "").toLowerCase();
  const materialFilter =
    materialIdRaw && UUID_RE.test(materialIdRaw) ? materialIdRaw : null;

  let counts;
  try {
    counts = await fetchSrsDueCountsForUser(
      supabase,
      user.id,
      materialFilter
    );
  } catch (error) {
    console.error("[srs/due-counts] database unavailable:", error);
    return NextResponse.json(
      { error: "Review counts temporarily unavailable." },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  return NextResponse.json(counts);
}
