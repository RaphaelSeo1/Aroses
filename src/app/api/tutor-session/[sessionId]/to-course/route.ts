import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCourseFromMaterial } from "@/lib/ai/study-generation";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
} from "@/types/tutor-session";

/**
 * POST /api/tutor-session/[sessionId]/to-course
 *
 * Converts a completed tutor session into a course in the student's
 * library. Pipeline:
 *
 *   1. Read the session (must be ended, recap_status='ready').
 *   2. Stitch a synthetic "material text" from the recap markdown +
 *      relevant excerpts of the transcript + reference summaries.
 *      The recap is the meat — it's already structured. We add the
 *      raw transcript as supporting context so the course generator
 *      can ask follow-up check questions.
 *   3. Call generateCourseFromMaterial(materialText) → CoursePayload.
 *   4. Insert into:
 *        - courses (title, description)
 *        - exam_groups (default "From tutor session")
 *        - study_materials (with course_payload)
 *   5. Return the new courseId for the client to redirect to.
 *
 * Errors are surfaced to the client; the row is left in a half-built
 * state ONLY if step 4 fails partway, which is rare. If the generator
 * hits its timeout we return 504 so the client can offer to retry.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

function buildMaterialText(input: {
  title: string;
  modeTag: TutorSessionModeTag | null;
  recapMarkdown: string | null;
  transcript: TutorSessionMessage[];
  referenceSummary: string;
}): string {
  const parts: string[] = [];
  parts.push(`# ${input.title}`);
  if (input.modeTag) {
    parts.push(`(Mode: ${input.modeTag.replace(/_/g, " ")})`);
  }
  parts.push("");
  if (input.referenceSummary && input.referenceSummary.trim().length > 0) {
    parts.push("## Reference materials");
    parts.push(input.referenceSummary.trim());
    parts.push("");
  }
  if (input.recapMarkdown && input.recapMarkdown.trim().length > 0) {
    parts.push("## Recap");
    parts.push(input.recapMarkdown.trim());
    parts.push("");
  }
  // Last 30 turns of transcript max — enough to give the course
  // generator nuance without ballooning token usage.
  if (input.transcript.length > 0) {
    parts.push("## Conversation excerpts");
    const recent = input.transcript.slice(-30);
    for (const m of recent) {
      const speaker = m.role === "user" ? "Student" : "Rose";
      const content = m.content.trim();
      if (content.length === 0) continue;
      parts.push(`**${speaker}:** ${content}`);
    }
  }
  return parts.join("\n").slice(0, 80_000);
}

export async function POST(_req: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select(
      "id, user_id, title, mode_tag, recap_markdown, recap_status, conversation_transcript, reference_summary"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (sessionRow.recap_status !== "ready" || !sessionRow.recap_markdown) {
    return NextResponse.json(
      {
        error:
          "Recap isn't ready yet. End the session first so Rose can generate the recap, then come back here.",
      },
      { status: 400 }
    );
  }

  const transcript: TutorSessionMessage[] = Array.isArray(
    sessionRow.conversation_transcript
  )
    ? (sessionRow.conversation_transcript as TutorSessionMessage[])
    : [];

  // 1. Generate the course payload.
  const materialText = buildMaterialText({
    title: sessionRow.title,
    modeTag: (sessionRow.mode_tag as TutorSessionModeTag) || null,
    recapMarkdown: sessionRow.recap_markdown,
    transcript,
    referenceSummary: sessionRow.reference_summary ?? "",
  });

  let payload;
  try {
    payload = await generateCourseFromMaterial(materialText);
  } catch (e) {
    console.error("[tutor-session to-course generate]", e);
    return NextResponse.json(
      { error: "Couldn't generate the course this time. Try again." },
      { status: 504 }
    );
  }

  // 2. Insert the course.
  const courseTitle =
    payload.title ||
    sessionRow.title ||
    `From tutor session · ${new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`;
  const courseDescription =
    typeof (payload as { description?: unknown }).description === "string"
      ? ((payload as { description?: string }).description as string).slice(0, 600)
      : `Built from your tutor session "${sessionRow.title}".`;

  const { data: maxRow } = await supabase
    .from("courses")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

  const { data: courseRow, error: courseErr } = await supabase
    .from("courses")
    .insert({
      user_id: user.id,
      title: courseTitle,
      description: courseDescription,
      sort_order: nextOrder,
    })
    .select("id")
    .single();
  if (courseErr || !courseRow) {
    console.error("[tutor-session to-course insert course]", courseErr);
    return NextResponse.json(
      { error: "Couldn't save the course." },
      { status: 500 }
    );
  }

  // 3. Seed an exam_group named after the session so the workspace
  //    sidebar shows "From tutor session" as the section label.
  const { data: groupRow } = await supabase
    .from("exam_groups")
    .insert({
      course_id: courseRow.id,
      user_id: user.id,
      name: "From tutor session",
      sort_order: 0,
    })
    .select("id")
    .single();

  // 4. Insert the study_materials row carrying the generated payload.
  //    Use the admin client because the schema in this codebase tends
  //    to be permissive but we may need elevated rights to bypass any
  //    trigger that expects an associated PDF ingest job.
  const admin = createAdminClient();
  const client = admin ?? supabase;
  const { data: materialRow, error: materialErr } = await client
    .from("study_materials")
    .insert({
      user_id: user.id,
      course_id: courseRow.id,
      exam_group_id: groupRow?.id ?? null,
      file_name: `${sessionRow.title}.session`,
      summary: courseDescription,
      key_concepts: [] as string[],
      questions: [] as unknown[],
      course_payload: payload,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (materialErr || !materialRow) {
    console.error("[tutor-session to-course insert material]", materialErr);
    // Clean up the orphan course row to avoid clutter in the library.
    await supabase.from("courses").delete().eq("id", courseRow.id);
    return NextResponse.json(
      { error: "Couldn't save the course." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    courseId: courseRow.id,
    materialId: materialRow.id,
  });
}
