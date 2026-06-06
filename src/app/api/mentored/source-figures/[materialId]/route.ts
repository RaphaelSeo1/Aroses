import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { loadSourceFiguresForModule } from "@/lib/mentored/source-figures";

/**
 * GET /api/mentored/source-figures/[materialId]?moduleId=N
 *
 * Returns the figures/page-renders extracted from the upload, grouped by the
 * 0-based lesson index within the requested module:
 *
 *   { figuresByLesson: { [lessonIndex: number]: IngestSourceImageRecord[] } }
 *
 * Used by Mentored Learning to show the actual figure from the student's PDF
 * while Rose teaches the matching concept. Empty object when the material has
 * no extracted figures.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const url = new URL(request.url);
  const moduleIdRaw = url.searchParams.get("moduleId");
  const moduleId = moduleIdRaw != null ? Number(moduleIdRaw) : Number.NaN;
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Missing moduleId." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const figuresByLesson = await loadSourceFiguresForModule(
    supabase,
    materialId,
    Math.trunc(moduleId)
  );

  return NextResponse.json({ figuresByLesson });
}
