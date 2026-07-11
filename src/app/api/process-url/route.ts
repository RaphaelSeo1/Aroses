import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasCourseEdit } from "@/lib/collaboration/api-guards";
import { fetchReferenceUrl } from "@/lib/fetch-reference-url";
import { createIngestJobFromText } from "@/lib/notes/create-ingest-job-from-text";
import { parseCourseOutputLanguage } from "@/lib/course-output-language";
import { UUID_RE } from "@/lib/study-ingest/path";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/process-url
 *
 * Fetch a public web page (or PDF URL), park the extracted text as a
 * transcript-review ingest job — same handoff as notes → course.
 *
 * Body: { courseId, examGroupId, url, studyContext?, outputLanguage? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  const examGroupId =
    typeof body.examGroupId === "string" ? body.examGroupId : "";
  const url = typeof body.url === "string" ? body.url : "";
  const studyContext =
    typeof body.studyContext === "string" ? body.studyContext : undefined;
  const outputLanguage = parseCourseOutputLanguage(body.outputLanguage);

  if (!UUID_RE.test(courseId) || !UUID_RE.test(examGroupId)) {
    return NextResponse.json(
      { error: "Invalid course or section id." },
      { status: 400 }
    );
  }
  if (!url.trim()) {
    return NextResponse.json({ error: "URL is required." }, { status: 400 });
  }

  const allowed = await hasCourseEdit(supabase, user.id, courseId);
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: group } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("id", examGroupId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "Section not found." }, { status: 404 });
  }

  let fetched;
  try {
    fetched = await fetchReferenceUrl(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't fetch that link.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const title = fetched.title || fetched.hostname;
  const bodyText = `[from link: ${fetched.url}]\n\n${fetched.text}`;

  const result = await createIngestJobFromText(supabase, {
    userId: user.id,
    courseId,
    examGroupId,
    title,
    body: bodyText,
    studyContext,
    outputLanguage,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { jobId: result.jobId, title },
    { status: 201 }
  );
}
