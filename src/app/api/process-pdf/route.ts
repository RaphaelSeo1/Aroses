import { RateLimitError, APIError } from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { generateCourseFromMaterial } from "@/lib/ai/study-generation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_STUDY_PDF_BYTES,
  STUDY_PDF_INGEST_BUCKET,
} from "@/lib/study-pdf-ingest";
import {
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
  stripKnownDocumentExtension,
} from "@/lib/study-material-display-name";

export const runtime = "nodejs";

/** Large PDF + Claude generation — Pro / Fluid; Hobby may still cap lower. */
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INGEST_OBJECT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

async function removeIngestObject(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  storagePath: string
) {
  await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .remove([storagePath])
    .catch(() => {});
}

export async function POST(request: Request) {
  const t0 = Date.now();
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected JSON: courseId, examGroupId, storagePath." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { courseId, examGroupId, storagePath, originalFileName } = body as {
    courseId?: unknown;
    examGroupId?: unknown;
    storagePath?: unknown;
    originalFileName?: unknown;
  };

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course" }, { status: 400 });
  }

  if (typeof examGroupId !== "string" || !UUID_RE.test(examGroupId)) {
    return NextResponse.json(
      { error: "Choose a section for this upload." },
      { status: 400 }
    );
  }

  if (typeof storagePath !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid storagePath." },
      { status: 400 }
    );
  }

  const prefix = `${user.id}/`;
  if (!storagePath.startsWith(prefix)) {
    return NextResponse.json(
      { error: "Upload path does not match your account." },
      { status: 403 }
    );
  }

  const objectKey = storagePath.slice(prefix.length);
  if (!INGEST_OBJECT_RE.test(objectKey)) {
    return NextResponse.json(
      { error: "Invalid ingest file name." },
      { status: 400 }
    );
  }

  if (storagePath.includes("..") || storagePath.includes("\\")) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server is not configured for storage (missing service role)." },
      { status: 500 }
    );
  }

  const { data: courseOwn } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!courseOwn) {
    await removeIngestObject(admin, storagePath);
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
    await removeIngestObject(admin, storagePath);
    return NextResponse.json(
      { error: "Invalid section for this course." },
      { status: 403 }
    );
  }

  let buf: Buffer;
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(STUDY_PDF_INGEST_BUCKET)
      .download(storagePath);

    if (dlErr || !blob) {
      console.error("[process-pdf] download", dlErr);
      return NextResponse.json(
        {
          error:
            "Could not read the uploaded PDF from storage. Try uploading again.",
        },
        { status: 502 }
      );
    }

    buf = Buffer.from(await blob.arrayBuffer());
  } catch (e) {
    console.error("[process-pdf] download unexpected", e);
    await removeIngestObject(admin, storagePath);
    return NextResponse.json(
      { error: "Could not read the uploaded PDF from storage." },
      { status: 502 }
    );
  }

  if (buf.length > MAX_STUDY_PDF_BYTES) {
    await removeIngestObject(admin, storagePath);
    return NextResponse.json(
      {
        error:
          "PDF is too large for this server (max 40 MB). Split the file or export fewer pages.",
      },
      { status: 413 }
    );
  }

  console.info("[process-pdf] start", {
    bytes: buf.length,
    path: storagePath.slice(0, 80),
  });

  try {
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
      typeof originalFileName === "string" && originalFileName.trim().length > 0
        ? originalFileName.trim()
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
      console.error("[process-pdf] insert study_materials", error);
      return NextResponse.json(
        {
          error: "Could not save study material.",
          ...(process.env.NODE_ENV === "development" && {
            debug: error.message,
          }),
        },
        { status: 500 }
      );
    }

    console.info("[process-pdf] ok", {
      ms: Date.now() - t0,
      materialId: row.id,
    });

    return NextResponse.json({ materialId: row.id });
  } catch (e) {
    console.error("process-pdf unexpected error", e);
    const detail =
      process.env.NODE_ENV === "development" && e instanceof Error
        ? e.message
        : undefined;
    return NextResponse.json(
      {
        error:
          "Upload failed unexpectedly on the server. Try again or use a smaller PDF.",
        ...(detail ? { debug: detail } : {}),
      },
      { status: 500 }
    );
  } finally {
    await removeIngestObject(admin, storagePath);
  }
}
