import { NextResponse } from "next/server";
import { canEditStudyMaterial } from "@/lib/collaboration/permissions";
import { recordStudyMaterialEdit } from "@/lib/collaboration/record-material-edit";
import { finalizeMaterialSectionLabel } from "@/lib/study-material-display-name";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

export async function PATCH(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof (body as { fileName?: unknown }).fileName === "string"
      ? (body as { fileName: string }).fileName.trim()
      : "";
  const fileName = finalizeMaterialSectionLabel(raw);

  if (fileName.length < 1 || fileName.length > 240) {
    return NextResponse.json(
      { error: "Name must be 1–240 characters." },
      { status: 400 }
    );
  }

  const allowed = await canEditStudyMaterial(supabase, user.id, materialId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("study_materials")
    .update({ file_name: fileName })
    .eq("id", materialId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not update." }, { status: 500 });
  }

  await recordStudyMaterialEdit(supabase, materialId, user.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canEditStudyMaterial(supabase, user.id, materialId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("study_materials")
    .delete()
    .eq("id", materialId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
