import { NextResponse } from "next/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const nowIso = new Date().toISOString();

  // Pull the user's materials once so we can attach names to the rollup
  // (cheap — we already do this elsewhere for the dashboard).
  let matsQuery = supabase
    .from("study_materials")
    .select("id, file_name, course_id, courses ( id, title )")
    .eq("user_id", user.id);
  if (materialFilter) matsQuery = matsQuery.eq("id", materialFilter);
  const { data: matsRaw } = await matsQuery;

  type MaterialRow = {
    id: string;
    file_name: string | null;
    course_id: string | null;
    courses:
      | { id: string; title: string | null }
      | { id: string; title: string | null }[]
      | null;
  };
  const materials = (matsRaw ?? []) as unknown as MaterialRow[];

  const byMaterial = new Map<
    string,
    {
      materialId: string;
      fileName: string;
      courseId: string | null;
      courseTitle: string | null;
      module: number;
      personal: number;
      total: number;
    }
  >();
  for (const m of materials) {
    byMaterial.set(m.id, {
      materialId: m.id,
      fileName: m.file_name ?? "Untitled upload",
      courseId: deriveCourseId(m),
      courseTitle: deriveCourseTitle(m),
      module: 0,
      personal: 0,
      total: 0,
    });
  }

  // -------- module-card counts -------------------------------------------
  let modQ = supabase
    .from("user_module_card_srs")
    .select("material_id", { count: "exact" })
    .eq("user_id", user.id)
    .lte("due_at", nowIso);
  if (materialFilter) modQ = modQ.eq("material_id", materialFilter);
  const { data: modRows } = await modQ;
  for (const row of modRows ?? []) {
    const bucket = byMaterial.get(row.material_id as string);
    if (bucket) bucket.module += 1;
  }

  // -------- personal-card counts -----------------------------------------
  let perQ = supabase
    .from("user_personal_quiz_items")
    .select("material_id")
    .eq("user_id", user.id)
    .lte("due_at", nowIso);
  if (materialFilter) perQ = perQ.eq("material_id", materialFilter);
  const { data: perRows } = await perQ;
  for (const row of perRows ?? []) {
    const bucket = byMaterial.get(row.material_id as string);
    if (bucket) bucket.personal += 1;
  }

  // Finalize per-bucket totals + global totals.
  let totalModule = 0;
  let totalPersonal = 0;
  for (const b of byMaterial.values()) {
    b.total = b.module + b.personal;
    totalModule += b.module;
    totalPersonal += b.personal;
  }

  return NextResponse.json({
    total: totalModule + totalPersonal,
    module: totalModule,
    personal: totalPersonal,
    byMaterial: [...byMaterial.values()]
      .filter((b) => b.total > 0 || materialFilter) // hide empty courses globally
      .sort((a, b) => b.total - a.total),
  });
}

type MaterialRow = {
  course_id: string | null;
  courses:
    | { id: string; title: string | null }
    | { id: string; title: string | null }[]
    | null;
};

function deriveCourseId(m: MaterialRow): string | null {
  if (m.course_id) return m.course_id;
  const c = m.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.id ?? null;
  return c.id ?? null;
}

function deriveCourseTitle(m: MaterialRow): string | null {
  const c = m.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.title ?? null;
  return c.title ?? null;
}
