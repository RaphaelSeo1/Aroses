import { NextResponse } from "next/server";
import { searchWikimediaImage } from "@/lib/images/wikimedia";
import type { WikimediaImageType } from "@/lib/images/wikimedia";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tutor-session/[sessionId]/image
 *
 * On-demand Wikimedia image search scoped to a tutor session. Same
 * pipeline as /api/mentored/image but checks tutor_session ownership
 * instead of study_materials access. Cache rows are namespaced by
 * session id in the same `mentored_image_requests` table — the
 * column is generically named `material_id` but it's just a UUID
 * scoping key, not a hard FK to study_materials.
 *
 * Body: { query: string, imageType?: "diagram" | "photo" | "illustration" }
 *
 * Response: { image: WikimediaImage | null, rateLimited: boolean }
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

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

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  let body: { query?: string; imageType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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

  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Cache lookup — keyed by (sessionId-as-material_id, query).
  const { data: cached } = await supabase
    .from("mentored_image_requests")
    .select(
      "image_url, image_thumb_url, source_page_url, attribution, image_type, not_found"
    )
    .eq("material_id", sessionId)
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

  // Rate limit at 5 distinct (uncached) lookups / hour / session.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("mentored_image_requests")
    .select("id", { count: "exact", head: true })
    .eq("material_id", sessionId)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json({ image: null, rateLimited: true });
  }

  const result = await searchWikimediaImage(normalized, imageType);
  await supabase.from("mentored_image_requests").upsert(
    {
      material_id: sessionId,
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
