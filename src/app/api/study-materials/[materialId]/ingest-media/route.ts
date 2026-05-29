import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { parseIngestMedia } from "@/types/ingest-media";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

/**
 * GET signed URL for retained ingest audio/video on a study material.
 */
export async function GET(_request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const allowed = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: row } = await supabase
    .from("study_materials")
    .select("ingest_media")
    .eq("id", materialId)
    .maybeSingle();

  const media = parseIngestMedia(row?.ingest_media);
  if (!media) {
    return NextResponse.json({ error: "No media for this material." }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Storage not configured." }, { status: 500 });
  }

  const { data, error } = await admin.storage
    .from(media.bucket)
    .createSignedUrl(media.storagePath, 60 * 60);

  if (error || !data?.signedUrl) {
    console.error("[ingest-media] signed url", error);
    return NextResponse.json(
      { error: "Could not load media file." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    url: data.signedUrl,
    kind: media.kind,
    fileName: media.fileName,
    transcriptSegments: media.transcriptSegments ?? [],
  });
}
