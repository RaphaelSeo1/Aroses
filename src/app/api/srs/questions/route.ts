import { NextResponse } from "next/server";
import { canEditStudyMaterial } from "@/lib/collaboration/permissions";
import { recordStudyMaterialEdit } from "@/lib/collaboration/record-material-edit";
import {
  disableModuleReviewQuestion,
  parseReviewQuestionTarget,
  replaceModuleReviewQuestion,
  validateReviewQuestion,
} from "@/lib/srs/question-mutation";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";

export async function PATCH(request: Request) {
  const context = await parseRequest(request);
  if (context instanceof NextResponse) return context;

  const validation = validateReviewQuestion(context.body.question);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (context.target.kind === "personal") {
    const { data, error } = await context.supabase
      .from("user_personal_quiz_items")
      .update({ item: validation.question })
      .eq("id", context.target.personalItemId)
      .eq("user_id", context.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[srs/questions PATCH personal]", error);
      return NextResponse.json({ error: "Could not save question." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, question: validation.question });
  }

  const editable = await canEditStudyMaterial(
    context.supabase,
    context.userId,
    context.target.materialId
  );
  if (!editable) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const loaded = await loadModulePayload(
    context.supabase,
    context.target.materialId
  );
  if (!loaded.ok) return loaded.response;
  const next = replaceModuleReviewQuestion(
    loaded.payload,
    context.target.questionIndex,
    validation.question
  );
  if (!next) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  const saved = await saveModulePayload(
    context.supabase,
    context.target.materialId,
    next
  );
  if (!saved) {
    return NextResponse.json({ error: "Could not save question." }, { status: 500 });
  }
  await recordStudyMaterialEdit(
    context.supabase,
    context.target.materialId,
    context.userId
  );
  return NextResponse.json({ ok: true, question: validation.question });
}

export async function DELETE(request: Request) {
  const context = await parseRequest(request);
  if (context instanceof NextResponse) return context;

  if (context.target.kind === "personal") {
    const { data, error } = await context.supabase
      .from("user_personal_quiz_items")
      .delete()
      .eq("id", context.target.personalItemId)
      .eq("user_id", context.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[srs/questions DELETE personal]", error);
      return NextResponse.json(
        { error: "Could not delete question." },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  const editable = await canEditStudyMaterial(
    context.supabase,
    context.userId,
    context.target.materialId
  );
  if (!editable) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const loaded = await loadModulePayload(
    context.supabase,
    context.target.materialId
  );
  if (!loaded.ok) return loaded.response;
  const next = disableModuleReviewQuestion(
    loaded.payload,
    context.target.questionIndex
  );
  if (!next) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  const saved = await saveModulePayload(
    context.supabase,
    context.target.materialId,
    next
  );
  if (!saved) {
    return NextResponse.json(
      { error: "Could not delete question." },
      { status: 500 }
    );
  }
  await recordStudyMaterialEdit(
    context.supabase,
    context.target.materialId,
    context.userId
  );
  return NextResponse.json({ ok: true });
}

async function parseRequest(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const target = parseReviewQuestionTarget(body.target);
  if (!target) {
    return NextResponse.json({ error: "Invalid question target." }, { status: 400 });
  }
  return { supabase, userId: user.id, body, target };
}

async function loadModulePayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  materialId: string
): Promise<
  | { ok: true; payload: CoursePayload }
  | { ok: false; response: NextResponse }
> {
  const { data, error } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("id", materialId)
    .maybeSingle();
  if (error) {
    console.error("[srs/questions load module]", error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not load question." },
        { status: 500 }
      ),
    };
  }
  const payload = data?.course_payload as CoursePayload | null;
  if (!payload || !Array.isArray(payload.modules)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Question not found." },
        { status: 404 }
      ),
    };
  }
  return { ok: true, payload };
}

async function saveModulePayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  materialId: string,
  payload: CoursePayload
): Promise<boolean> {
  const { data, error } = await supabase
    .from("study_materials")
    .update({ course_payload: payload })
    .eq("id", materialId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[srs/questions save module]", error);
    return false;
  }
  return true;
}
