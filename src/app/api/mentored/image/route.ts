import { NextResponse } from "next/server";
import { searchWikimediaImage } from "@/lib/images/wikimedia";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type { WikimediaImageType } from "@/lib/images/wikimedia";

/**
 * POST /api/mentored/image
 *
 * On-demand image search for Mentored Learning. Triggered when:
 *   - Rose decides a visual would help and calls her `generateImage`
 *     tool, OR
 *   - The student asks "show me a diagram of X", "draw me Y", etc.
 *     (intent detected client-side; the request body is the
 *     extracted query.)
 *
 * Body:
 *   { materialId, query, imageType?: "diagram" | "photo" | "illustration" }
 *
 * Cache key: (material_id, normalized_query). Identical queries
 * across students share the same Wikimedia result so we don't hit
 * the API repeatedly.
 *
 * Per-session rate limit: 5 distinct queries per (user, material) in
 * the last hour. Above that we return `{ rateLimited: true }` and
 * the client falls back gracefully (Rose continues without an image
 * — per spec, no AI generation fallback).
 */

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isImageType(v: unknown): v is WikimediaImageType {
  return v === "diagram" || v === "photo" || v === "illustration";
}

export async function POST(request: Request) {
  let body: { materialId?: string; query?: string; imageType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }
  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }
  const normalized = normalizeQuery(body.query);
  if (normalized.length < 3) {
    return NextResponse.json({ error: "Query too short." }, { status: 400 });
  }
  const imageType: WikimediaImageType = isImageType(body.imageType)
    ? body.imageType
    : "illustration";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, body.materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // 1. Cache hit? Distinct queries are cached forever — same query
  //    always returns the same image.
  const { data: cached } = await supabase
    .from("mentored_image_requests")
    .select(
      "image_url, image_thumb_url, source_page_url, attribution, image_type, not_found"
    )
    .eq("material_id", body.materialId)
    .eq("query", normalized)
    .maybeSingle();

  if (cached) {
    if (cached.not_found || !cached.image_url) {
      return NextResponse.json({ image: null, rateLimited: false });
    }
    return NextResponse.json({
      image: {
        url: cached.image_url,
        thumbUrl: cached.image_thumb_url ?? cached.image_url,
        sourceUrl: cached.source_page_url ?? "",
        attribution: cached.attribution ?? "",
        type: isImageType(cached.image_type) ? cached.image_type : imageType,
      },
      rateLimited: false,
    });
  }

  // 2. Per-(user, material) rate limit. Only counts distinct queries
  //    in the window so the cache hit path above doesn't burn budget.
  //    We approximate "per user" by looking at created_at in the
  //    requests table since the cache row's creator isn't recorded —
  //    cheap enough.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("mentored_image_requests")
    .select("id", { count: "exact", head: true })
    .eq("material_id", body.materialId)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json({ image: null, rateLimited: true });
  }

  // 3. Search Wikimedia, persist either the result or a "not_found"
  //    cache row so repeat queries don't re-hit the API.
  const result = await searchWikimediaImage(normalized, imageType);
  await supabase.from("mentored_image_requests").upsert(
    {
      material_id: body.materialId,
      query: normalized,
      image_type: imageType,
      image_url: result?.imageUrl ?? null,
      image_thumb_url: result?.thumbUrl ?? null,
      source_page_url: result?.sourcePageUrl ?? null,
      attribution: result?.attribution ?? null,
      not_found: !result,
    },
    { onConflict: "material_id,query" }
  );

  if (!result) {
    return NextResponse.json({ image: null, rateLimited: false });
  }
  return NextResponse.json({
    image: {
      url: result.imageUrl,
      thumbUrl: result.thumbUrl,
      sourceUrl: result.sourcePageUrl,
      attribution: result.attribution,
      type: imageType,
    },
    rateLimited: false,
  });
}
