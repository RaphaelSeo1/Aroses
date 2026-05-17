import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { generateOnboardingQuiz } from "@/lib/ai/mentored";
import type { CoursePayload } from "@/types/course";

/**
 * POST /api/mentored/onboarding/quiz
 *
 * Body: { materialId: string, count?: 3..5 }
 *
 * Returns 3-5 background-knowledge MCQs to use during onboarding for this
 * course. Not stored here — the client calls this then saves the resulting
 * `levelQuiz` back via the onboarding upsert endpoint.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { materialId?: string; count?: number };
  try {
    body = (await request.json()) as { materialId?: string; count?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

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

  // Load the course payload so the AI can write background questions
  // appropriate to the subject area.
  const { data: row } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("id", body.materialId)
    .maybeSingle();

  const payload = row?.course_payload as CoursePayload | null;
  if (!payload || !payload.title) {
    return NextResponse.json(
      { error: "Course is not ready yet — finish generating before starting onboarding." },
      { status: 409 }
    );
  }

  try {
    const questions = await generateOnboardingQuiz({
      course: payload,
      count: body.count,
    });
    if (questions.length < 3) {
      return NextResponse.json(
        { error: "Could not generate enough questions. Try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ questions });
  } catch (e) {
    console.error("[mentored/onboarding/quiz]", e);
    return NextResponse.json(
      { error: "Could not generate quiz. Try again shortly." },
      { status: 502 }
    );
  }
}
