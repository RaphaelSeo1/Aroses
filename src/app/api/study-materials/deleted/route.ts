import { NextResponse } from "next/server";
import { canEditStudyMaterial } from "@/lib/collaboration/permissions";
import {
  purgeStudyMaterial,
  restoreStudyMaterial,
} from "@/lib/study-materials/soft-delete";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_IDS = 40;

type DeletedMaterialRow = {
  id: string;
  file_name: string | null;
  course_id: string | null;
  deleted_at: string;
  courses:
    | { id: string; title: string | null }
    | { id: string; title: string | null }[]
    | null;
};

function courseTitle(
  courses:
    | { id: string; title: string | null }
    | { id: string; title: string | null }[]
    | null
): string | null {
  if (!courses) return null;
  if (Array.isArray(courses)) return courses[0]?.title ?? null;
  return courses.title ?? null;
}

/** GET /api/study-materials/deleted — soft-deleted module review materials. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("study_materials")
    .select(
      "id, file_name, course_id, deleted_at, courses ( id, title )"
    )
    .eq("user_id", user.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    if (isMissingDbColumnError(error, "deleted_at")) {
      return NextResponse.json({ materials: [] });
    }
    console.error("[study-materials/deleted GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }

  const materials = ((data ?? []) as unknown as DeletedMaterialRow[]).map(
    (row) => ({
      materialId: row.id,
      fileName: row.file_name ?? "Untitled upload",
      courseId: row.course_id,
      courseTitle: courseTitle(row.courses),
      deletedAt: row.deleted_at,
    })
  );

  return NextResponse.json({ materials });
}

/**
 * POST /api/study-materials/deleted
 * body: { action: "restore" | "purge", materialIds: string[] }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown; materialIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "restore" && body.action !== "purge") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (!Array.isArray(body.materialIds) || body.materialIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one material." },
      { status: 400 }
    );
  }

  const materialIds = body.materialIds
    .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    .slice(0, MAX_IDS);

  if (materialIds.length === 0) {
    return NextResponse.json({ error: "Invalid selection." }, { status: 400 });
  }

  let ok = 0;
  for (const materialId of materialIds) {
    const allowed = await canEditStudyMaterial(supabase, user.id, materialId);
    if (!allowed) continue;

    if (body.action === "restore") {
      if (await restoreStudyMaterial(supabase, materialId)) ok += 1;
    } else if (await purgeStudyMaterial(supabase, materialId)) {
      ok += 1;
    }
  }

  return NextResponse.json(
    body.action === "restore" ? { restored: ok } : { deleted: ok, permanent: true }
  );
}
