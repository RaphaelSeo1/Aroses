import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasCourseEdit } from "@/lib/collaboration/api-guards";
import { loadAppSource, type AppSourceKind } from "@/lib/course-build/app-sources";
import { MAX_BUILD_TITLE_CHARS, type NewBuildSource } from "@/lib/course-build/create-build";
import { checkCanBuild, outputLanguageName, startCourseBuild } from "@/lib/course-build/start";
import { fetchReferenceUrl } from "@/lib/fetch-reference-url";
import { detectIngestFormat, extensionOfFileName, MAX_INGEST_FILES_PER_BATCH } from "@/lib/study-ingest/formats";
import { isValidIngestStoragePath, UUID_RE } from "@/lib/study-ingest/path";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The first run of the build happens in this request's after() window. */
export const maxDuration = 300;

const MAX_URLS = 5;
const MAX_TEXTS = 5;
const MAX_TEXT_CHARS = 200_000;
const MIN_TEXT_CHARS = 40;
const APP_KINDS = new Set<AppSourceKind>(["note", "live_session", "tutor_session"]);

type Body = {
  courseId?: unknown;
  newCourseTitle?: unknown;
  sectionId?: unknown;
  newSectionName?: unknown;
  files?: unknown;
  texts?: unknown;
  urls?: unknown;
  app?: unknown;
  outputLanguage?: unknown;
  studyGoal?: unknown;
  sources?: unknown;
  title?: unknown;
};

class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string
  ) {
    super(message);
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);

function fileSource(userId: string, raw: unknown): NewBuildSource {
  const f = (raw ?? {}) as { storagePath?: unknown; name?: unknown };
  const storagePath = str(f.storagePath, 300);
  const name = str(f.name, 200) || storagePath.split("/").pop() || "file";
  if (!isValidIngestStoragePath(storagePath, userId)) throw new InputError(`${name} didn't upload correctly. Try adding it again.`);
  const ext = extensionOfFileName(name);
  const kind = detectIngestFormat(name);
  if (kind === "pdf") return { kind: "pdf", label: name, storagePath };
  if (kind === "word" && ext === "docx") return { kind: "docx", label: name, storagePath };
  if (kind === "slides" && ext === "pptx") return { kind: "pptx", label: name, storagePath };
  if (kind === "text" || kind === "markdown" || kind === "rtf") return { kind: "text", label: name, storagePath };
  if (kind === "audio") return { kind: "audio", label: name, storagePath };
  if (kind === "video") return { kind: "video", label: name, storagePath };
  if (ext === "doc" || ext === "ppt") throw new InputError(`${name} is an old Office format. Save it as .${ext}x and upload it again.`);
  if (kind === "image") throw new InputError(`${name} is an image. Images can't be built into a course yet; upload a PDF or slides instead.`);
  throw new InputError(`${name} is a file type the course builder can't read.`);
}

function textSource(raw: unknown): NewBuildSource {
  const t = (raw ?? {}) as { label?: unknown; text?: unknown };
  const text = typeof t.text === "string" ? t.text.trim().slice(0, MAX_TEXT_CHARS) : "";
  if (text.length < MIN_TEXT_CHARS) throw new InputError("Pasted text is too short to build from.");
  return { kind: "text", label: str(t.label, 200) || "Pasted text", text };
}

async function appSource(supabase: SupabaseClient, userId: string, raw: unknown): Promise<NewBuildSource> {
  const a = (raw ?? {}) as { kind?: unknown; id?: unknown };
  const kind = a.kind as AppSourceKind;
  const id = str(a.id, 64);
  if (!APP_KINDS.has(kind) || !UUID_RE.test(id)) throw new InputError("Something you picked to build from is invalid.");
  const loaded = await loadAppSource(supabase, userId, kind, id);
  if (!loaded) throw new InputError("We couldn't find that item. It may have been deleted.", 404);
  if (loaded.text.trim().length < MIN_TEXT_CHARS) {
    throw new InputError(`${loaded.label} doesn't have enough content to build a course from yet.`);
  }
  return { kind, label: loaded.label, text: loaded.text, refId: loaded.refId };
}

async function urlSource(raw: unknown): Promise<NewBuildSource | null> {
  const url = str((raw as { url?: unknown } | null)?.url, 2000);
  if (!url) return null;
  try {
    const page = await fetchReferenceUrl(url);
    return { kind: "url", label: page.title || page.hostname, text: page.text, sourceUrl: page.url };
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : "We couldn't read that link.");
  }
}

async function resolveTarget(
  supabase: SupabaseClient,
  userId: string,
  body: Body
): Promise<{ courseId: string; examGroupId: string; createdCourse: boolean }> {
  let courseId = str(body.courseId, 64);
  let createdCourse = false;
  if (courseId) {
    if (!UUID_RE.test(courseId) || !(await hasCourseEdit(supabase, userId, courseId))) {
      throw new InputError("You can't add materials to that course.", 403);
    }
  } else {
    const title = str(body.newCourseTitle, 120);
    if (title.length < 2) throw new InputError("Give the new course a name (at least 2 characters).");
    const { data: maxRow } = await supabase
      .from("courses")
      .select("sort_order")
      .eq("user_id", userId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: course, error } = await supabase
      .from("courses")
      .insert({
        user_id: userId,
        title,
        description: "",
        sort_order: typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0,
      })
      .select("id")
      .single();
    if (error || !course) throw new InputError("We couldn't create the course. Try again.", 500);
    courseId = String(course.id);
    createdCourse = true;
  }

  const sectionId = str(body.sectionId, 64);
  if (sectionId) {
    const { data } = await supabase
      .from("exam_groups")
      .select("id")
      .eq("id", sectionId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (!data) throw new InputError("That section isn't part of this course.", 403);
    return { courseId, examGroupId: String(data.id), createdCourse };
  }

  const name = str(body.newSectionName, 120) || "Materials";
  if (!str(body.newSectionName, 120)) {
    const { data: existing } = await supabase
      .from("exam_groups")
      .select("id")
      .eq("course_id", courseId)
      .eq("name", name)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing) return { courseId, examGroupId: String(existing.id), createdCourse };
  }
  const { data: maxGroup } = await supabase
    .from("exam_groups")
    .select("sort_order")
    .eq("course_id", courseId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: group, error } = await supabase
    .from("exam_groups")
    .insert({
      course_id: courseId,
      user_id: userId,
      name,
      sort_order: typeof maxGroup?.sort_order === "number" ? maxGroup.sort_order + 1 : 0,
    })
    .select("id")
    .single();
  if (error || !group) {
    if (createdCourse) await supabase.from("courses").delete().eq("id", courseId);
    throw new InputError("We couldn't create the section. Try again.", 500);
  }
  return { courseId, examGroupId: String(group.id), createdCourse };
}

/** Short status for the "your course is ready" notifier: `?ids=a,b`. Read-only. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
    .slice(0, 20);
  if (ids.length === 0) return NextResponse.json({ builds: [] });
  const { data, error } = await supabase
    .from("course_builds")
    .select("id, status, course_id, material_id, plan, error_message")
    .in("id", ids);
  if (error) return NextResponse.json({ error: "Could not load builds." }, { status: 500 });
  return NextResponse.json(
    {
      builds: (data ?? []).map((b) => ({
        id: b.id,
        status: b.status,
        courseId: b.course_id,
        materialId: b.material_id,
        title: (b.plan as { title?: string } | null)?.title ?? null,
        error: b.error_message,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to build a course." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const blocked = await checkCanBuild(user.id, user.email ?? null);
  if (blocked && !blocked.ok) {
    return NextResponse.json({ error: blocked.error, code: blocked.code }, { status: blocked.status });
  }

  let createdCourseId: string | null = null;
  try {
    // `sources` keeps the student's reading order across kinds; the separate lists are the older shape.
    const ordered = Array.isArray(body.sources)
      ? body.sources.map((raw) => (raw ?? {}) as { type?: unknown })
      : [
          ...list(body.files).map((f) => ({ ...(f as object), type: "file" })),
          ...list(body.texts).map((t) => ({ ...(t as object), type: "text" })),
          ...list(body.app).map((a) => ({ ...(a as object), type: "app" })),
          ...list(body.urls).map((url) => ({ type: "url", url })),
        ];
    const count = (type: string) => ordered.filter((s) => s.type === type).length;
    if (count("file") > MAX_INGEST_FILES_PER_BATCH) throw new InputError(`Add at most ${MAX_INGEST_FILES_PER_BATCH} files at a time.`);
    if (count("text") > MAX_TEXTS || count("url") > MAX_URLS || count("app") > MAX_TEXTS) {
      throw new InputError("That's too many pasted texts or links for one build.");
    }

    const sources: NewBuildSource[] = [];
    for (const raw of ordered) {
      if (raw.type === "file") sources.push(fileSource(user.id, raw));
      else if (raw.type === "text") sources.push(textSource(raw));
      else if (raw.type === "app") sources.push(await appSource(supabase, user.id, raw));
      else if (raw.type === "url") {
        const source = await urlSource(raw);
        if (source) sources.push(source);
      } else throw new InputError("Something you picked to build from is invalid.");
    }

    if (sources.length === 0) throw new InputError("Add at least one file, link, or text to build from.");

    const target = await resolveTarget(supabase, user.id, body);
    if (target.createdCourse) createdCourseId = target.courseId;

    const started = await startCourseBuild({
      userId: user.id,
      email: user.email ?? null,
      courseId: target.courseId,
      examGroupId: target.examGroupId,
      sources,
      outputLanguage: outputLanguageName(body.outputLanguage),
      studyGoal: str(body.studyGoal, 300) || null,
      title: str(body.title, MAX_BUILD_TITLE_CHARS) || null,
    });
    if (!started.ok) {
      if (createdCourseId) await supabase.from("courses").delete().eq("id", createdCourseId);
      return NextResponse.json({ error: started.error, code: started.code }, { status: started.status });
    }
    return NextResponse.json(
      { buildId: started.buildId, courseId: target.courseId, sectionId: target.examGroupId },
      { status: 202 }
    );
  } catch (err) {
    if (createdCourseId) await supabase.from("courses").delete().eq("id", createdCourseId);
    if (err instanceof InputError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[course-build] POST", err);
    return NextResponse.json({ error: "We couldn't start the build. Try again in a moment." }, { status: 500 });
  }
}
