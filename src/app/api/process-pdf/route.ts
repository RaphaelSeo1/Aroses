import { RateLimitError, APIError } from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { generateCourseFromMaterial } from "@/lib/ai/study-generation";
import {
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
  stripKnownDocumentExtension,
} from "@/lib/study-material-display-name";

export const runtime = "nodejs";

/** Large PDF + Claude generation may exceed default ~60s on some hosts. */
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  const courseId = form.get("courseId");
  const examGroupId = form.get("examGroupId");

  if (!(file instanceof File) || typeof courseId !== "string") {
    return NextResponse.json(
      { error: "Missing file or courseId" },
      { status: 400 }
    );
  }

  if (typeof examGroupId !== "string" || !UUID_RE.test(examGroupId)) {
    return NextResponse.json(
      { error: "Choose an exam group for this upload." },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course" }, { status: 400 });
  }

  const { data: courseOwn } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!courseOwn) {
    return NextResponse.json({ error: "Course not found" }, { status: 403 });
  }

  const { data: groupOwn } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("id", examGroupId)
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!groupOwn) {
    return NextResponse.json(
      { error: "Invalid exam group for this course." },
      { status: 403 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  const parser = new PDFParse({ data: buf });
  try {
    const parsed = await parser.getText();
    text = (parsed.text ?? "").trim();
  } catch {
    return NextResponse.json(
      { error: "Could not read PDF. Try another file." },
      { status: 422 }
    );
  } finally {
    await parser.destroy();
  }

  if (text.length < 80) {
    return NextResponse.json(
      {
        error:
          "Not enough text extracted from this PDF. Try slides with selectable text or another file.",
      },
      { status: 422 }
    );
  }

  let payload;
  try {
    payload = await generateCourseFromMaterial(text);
  } catch (e) {
    console.error(e);
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        {
          error:
            "The AI service rate limit was hit. Wait one minute and try again.",
        },
        { status: 429 }
      );
    }
    if (e instanceof APIError && typeof e.status === "number") {
      if (e.status === 529 || e.status === 503) {
        return NextResponse.json(
          {
            error:
              "The AI service is temporarily overloaded. Try again in a few minutes.",
          },
          { status: 503 }
        );
      }
      if (e.status === 429) {
        return NextResponse.json(
          {
            error:
              "Too many AI requests right now. Wait a minute and retry this file.",
          },
          { status: 429 }
        );
      }
    }
    const msg = e instanceof Error ? e.message : "";
    if (msg === "Missing ANTHROPIC_API_KEY") {
      return NextResponse.json(
        { error: "Server is not configured for AI. Contact support." },
        { status: 500 }
      );
    }
    if (msg.includes("Claude did not return valid JSON")) {
      return NextResponse.json(
        {
          error:
            "The model returned an incomplete response. Try uploading again, or use a smaller PDF.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        error:
          "AI processing failed (network or model timeout). Try again in a moment.",
      },
      { status: 502 }
    );
  }

  const { data: minRow } = await supabase
    .from("study_materials")
    .select("sort_order")
    .eq("exam_group_id", examGroupId)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  const nextSortOrder =
    typeof minRow?.sort_order === "number" ? minRow.sort_order - 1 : 0;

  const stemFromContent = deriveFileStemFromPayload(payload);
  const uploadLabel =
    typeof file.name === "string" && file.name.trim().length > 0
      ? file.name.trim()
      : "upload.pdf";
  const fromUploadStem =
    stripKnownDocumentExtension(uploadLabel) ||
    finalizeMaterialSectionLabel(uploadLabel);
  const storedFileName = stemFromContent
    ? finalizeMaterialSectionLabel(stemFromContent)
    : fromUploadStem.length > 0
      ? fromUploadStem
      : "Material";

  const { data: row, error } = await supabase
    .from("study_materials")
    .insert({
      user_id: user.id,
      course_id: courseId,
      exam_group_id: examGroupId,
      file_name: storedFileName,
      summary: payload.description,
      key_concepts: [] as string[],
      questions: [] as unknown[],
      course_payload: payload,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not save study material." },
      { status: 500 }
    );
  }

  return NextResponse.json({ materialId: row.id });
}
