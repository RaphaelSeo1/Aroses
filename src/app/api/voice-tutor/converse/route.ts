import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildLegacyStudyContext,
  buildStudyContextText,
  streamVoiceReply,
  type VoiceContinuationHint,
} from "@/lib/ai/study-chat";
import { formatSelfStudyTutorBlock } from "@/lib/self-study-context";
import { fetchCourseMaterialsForChat, buildCourseMapFromMaterials } from "@/lib/study-chat-context";
import {
  extractNavigationQuery,
  findAllStudyLocationsForQuery,
  isUnambiguousNavigation,
} from "@/lib/study-chat-nav";
import type { StudyChatTurn } from "@/types/study-chat";
import type { CoursePayload } from "@/types/course";
import type { MCQuestion } from "@/types/study";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_CONTENT_PER_MESSAGE = 8000;
const MAX_MESSAGES = 24;

function looksLikeNavigationIntent(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("take me") ||
    t.includes("go to") ||
    t.includes("jump to") ||
    t.includes("send me") ||
    t.includes("bring me") ||
    t.includes("where") ||
    t.includes("which module") ||
    t.includes("what module") ||
    t.includes("find") ||
    t.includes("search")
  );
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

  // Require authentication, matching every other voice-tutor route. The
  // study_materials fetch below runs through this cookie client so RLS still
  // scopes per-material read access (owner or public course); this guard stops
  // unauthenticated callers from driving the LLM stream at all.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    materialId?: string;
    moduleId?: number;
    quizOpen?: boolean;
    messages?: StudyChatTurn[];
    voiceLanguage?: string;
  };

  if (typeof b.materialId !== "string" || !UUID_RE.test(b.materialId)) {
    return NextResponse.json({ error: "Invalid materialId" }, { status: 400 });
  }

  const moduleId =
    typeof b.moduleId === "number" && Number.isFinite(b.moduleId)
      ? b.moduleId
      : undefined;
  const quizOpen = Boolean(b.quizOpen);
  const voiceLanguage =
    typeof b.voiceLanguage === "string" ? b.voiceLanguage : undefined;

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  if (b.messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "Too many messages" }, { status: 400 });
  }

  const messages: StudyChatTurn[] = [];
  for (const m of b.messages) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string"
    ) {
      return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
    }
    if (m.content.length > MAX_CONTENT_PER_MESSAGE) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 });
    }
    messages.push({ role: m.role, content: m.content.trim() });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from user" },
      { status: 400 }
    );
  }

  let voiceInterruption: VoiceContinuationHint | undefined;
  const rawVc = (b as { voiceContinuation?: unknown }).voiceContinuation;
  if (rawVc && typeof rawVc === "object") {
    const o = rawVc as Record<string, unknown>;
    const sp =
      typeof o.spokenBeforeInterrupt === "string" ? o.spokenBeforeInterrupt : "";
    const nt = typeof o.notYetSpoken === "string" ? o.notYetSpoken : "";
    if (sp.trim() || nt.trim()) {
      voiceInterruption = {
        spokenBeforeInterrupt: sp.slice(0, 12_000),
        notYetSpoken: nt.slice(0, 12_000),
        streamIncomplete: o.streamIncomplete === true,
      };
    }
  }

  const { data: row, error: fetchErr } = await supabase
    .from("study_materials")
    .select("course_id, course_payload, summary, key_concepts, questions")
    .eq("id", b.materialId)
    .maybeSingle();

  // Fetch self-study context from the parent course (nullable).
  let studyContext: string | undefined;
  const resolvedCourseId =
    typeof row?.course_id === "string" ? row.course_id : null;
  if (resolvedCourseId) {
    const { data: courseCtxRow } = await supabase
      .from("courses")
      .select("study_context")
      .eq("id", resolvedCourseId)
      .maybeSingle();
    const raw = courseCtxRow?.study_context;
    studyContext =
      typeof raw === "string" && raw.trim().length > 0
        ? formatSelfStudyTutorBlock(raw.trim())
        : undefined;
  }

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const courseId = typeof row.course_id === "string" ? row.course_id : null;
  const payload = row.course_payload as CoursePayload | null;
  const hasStructuredCourse =
    payload != null &&
    typeof payload === "object" &&
    typeof payload.title === "string" &&
    Array.isArray(payload.modules) &&
    payload.modules.length > 0;

  let contextText: string;
  let courseMaterials: { id: string; course_payload: CoursePayload; label: string }[] =
    [];

  if (hasStructuredCourse) {
    const resolvedModuleId = moduleId ?? payload!.modules[0]?.id ?? 1;

    if (courseId) {
      courseMaterials = await fetchCourseMaterialsForChat(
        supabase,
        courseId,
        b.materialId,
        payload!
      );
    } else {
      courseMaterials = [
        {
          id: b.materialId,
          course_payload: payload!,
          label: payload!.title?.trim() || "Current upload",
        },
      ];
    }

    contextText = buildStudyContextText(payload!, {
      moduleId: resolvedModuleId,
      quizOpen,
      courseMap: buildCourseMapFromMaterials(courseMaterials),
      currentMaterialId: b.materialId,
    });
  } else {
    const summary = typeof row.summary === "string" ? row.summary : "";
    const keyConcepts = Array.isArray(row.key_concepts)
      ? row.key_concepts.filter((t): t is string => typeof t === "string")
      : [];
    const rawQ = row.questions;
    const questions = Array.isArray(rawQ) ? (rawQ as MCQuestion[]) : [];

    if (!summary.trim() && questions.length === 0) {
      return NextResponse.json(
        { error: "No study content found for this upload." },
        { status: 422 }
      );
    }

    contextText = buildLegacyStudyContext(summary, keyConcepts, questions);
  }

  // Navigation intent — server-side keyword match against the user's question.
  // We emit this as the FIRST SSE event so the client can navigate before the
  // spoken reply even finishes.
  let detectedAction: unknown | null = null;
  if (hasStructuredCourse && looksLikeNavigationIntent(last.content)) {
    const navMaterials =
      courseMaterials.length > 0
        ? courseMaterials
        : [{ id: b.materialId, course_payload: payload!, label: "Current upload" }];
    const navQuery = extractNavigationQuery(last.content);
    const matches = findAllStudyLocationsForQuery({
      materials: navMaterials,
      query: navQuery || last.content,
    });
    const pick = isUnambiguousNavigation(matches);
    if (pick) {
      detectedAction = {
        type: "navigate_to_location",
        materialId: pick.materialId,
        moduleId: pick.moduleId,
        reason: pick.reason,
      };
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseLine(event, data)));
        } catch {
          /* controller may already be closed if the client disconnected */
        }
      };

      if (detectedAction) send("action", detectedAction);

      try {
        for await (const delta of streamVoiceReply(
          contextText,
          messages,
          studyContext,
          voiceInterruption,
          voiceLanguage
        )) {
          send("text", { delta });
        }
        send("done", {});
      } catch (e) {
        console.error("voice converse stream error", e);
        send("error", { message: "Tutor stream failed." });
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
