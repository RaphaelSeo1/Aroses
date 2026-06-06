import { NextResponse } from "next/server";
import { generateSessionGreeting } from "@/lib/ai/mentored";
import { loadStudyContextForMaterial } from "@/lib/load-course-study-context";
import { formatSelfStudyTutorBlock } from "@/lib/self-study-context";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";

/**
 * POST /api/mentored/greeting
 *
 * Generates the short spoken greeting the AI tutor plays at the start of
 * every Mentored Learning session. The endpoint is intentionally
 * lightweight and uses the fast Haiku model so the audio can start
 * within ~1-2s of the page loading.
 *
 *   Body shape:
 *     {
 *       materialId: string,
 *       courseTitle: string,
 *       courseDescription?: string,
 *       firstLessonTitle?: string,
 *       lastLessonTitle?: string,
 *       scenario: "first_time" | "returning" | "all_complete"
 *     }
 *
 *   Response: { greeting: string }
 *
 * Auth: same RLS gate as the rest of /api/mentored — the caller must be
 * signed in AND be able to read the study material.
 *
 * Note: this endpoint only RETURNS text. The client passes the result
 * into the existing voice TTS pipeline. We don't synthesize on the
 * server so the latency budget is just Claude's generation time.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scenario = "first_time" | "returning" | "all_complete";

function isScenario(v: unknown): v is Scenario {
  return v === "first_time" || v === "returning" || v === "all_complete";
}

export async function POST(request: Request) {
  let body: {
    materialId?: unknown;
    courseTitle?: unknown;
    courseDescription?: unknown;
    firstLessonTitle?: unknown;
    lastLessonTitle?: unknown;
    scenario?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }
  if (typeof body.courseTitle !== "string" || body.courseTitle.trim() === "") {
    return NextResponse.json(
      { error: "courseTitle required." },
      { status: 400 }
    );
  }
  if (!isScenario(body.scenario)) {
    return NextResponse.json(
      { error: "Invalid scenario." },
      { status: 400 }
    );
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

  try {
    const studyContextRaw = await loadStudyContextForMaterial(
      supabase,
      body.materialId
    );
    const studyContext = studyContextRaw
      ? formatSelfStudyTutorBlock(studyContextRaw)
      : undefined;

    const greeting = await generateSessionGreeting({
      courseTitle: body.courseTitle.trim(),
      courseDescription:
        typeof body.courseDescription === "string"
          ? body.courseDescription
          : undefined,
      firstLessonTitle:
        typeof body.firstLessonTitle === "string"
          ? body.firstLessonTitle.trim() || undefined
          : undefined,
      lastLessonTitle:
        typeof body.lastLessonTitle === "string"
          ? body.lastLessonTitle.trim() || undefined
          : undefined,
      scenario: body.scenario,
      studyContext,
    });
    return NextResponse.json({ greeting });
  } catch (e) {
    console.error("[mentored/greeting]", e);
    // Soft fallback — the runner will still play a basic greeting so the
    // student isn't dropped into silence.
    return NextResponse.json(
      { error: "Greeting unavailable." },
      { status: 502 }
    );
  }
}
