import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildLegacyStudyContext,
  buildStudyContextText,
  runStudyChat,
} from "@/lib/ai/study-chat";
import {
  findBestModuleIdForQuery,
  findBestStudyLocationForQuery,
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

  // Require authentication before any LLM work. The study_materials fetch below
  // runs through this cookie client, so RLS still scopes read access per
  // material (owner or public course); this guard stops anonymous callers from
  // driving the model.
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
  };

  if (typeof b.materialId !== "string" || !UUID_RE.test(b.materialId)) {
    return NextResponse.json({ error: "Invalid materialId" }, { status: 400 });
  }

  const moduleId =
    typeof b.moduleId === "number" && Number.isFinite(b.moduleId)
      ? b.moduleId
      : undefined;
  const quizOpen = Boolean(b.quizOpen);

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

  const { data: row, error: fetchErr } = await supabase
    .from("study_materials")
    .select("course_id, course_payload, summary, key_concepts, questions")
    .eq("id", b.materialId)
    .maybeSingle();

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

  if (hasStructuredCourse) {
    const resolvedModuleId =
      moduleId ?? payload!.modules[0]?.id ?? 1;
    contextText = buildStudyContextText(payload!, {
      moduleId: resolvedModuleId,
      quizOpen,
    });
  } else {
    const summary = typeof row.summary === "string" ? row.summary : "";
    const keyConcepts = Array.isArray(row.key_concepts)
      ? row.key_concepts.filter((t): t is string => typeof t === "string")
      : [];
    const rawQ = row.questions;
    const questions = Array.isArray(rawQ)
      ? (rawQ as MCQuestion[])
      : [];

    if (!summary.trim() && questions.length === 0) {
      return NextResponse.json(
        { error: "No study content found for this upload." },
        { status: 422 }
      );
    }

    contextText = buildLegacyStudyContext(summary, keyConcepts, questions);
  }

  try {
    // Server-side fallback: if the user is asking to navigate, try searching the full payload
    // even if the model doesn't return an action.
    let fallbackAction: unknown | null = null;
    if (hasStructuredCourse && looksLikeNavigationIntent(last.content)) {
      // Search this material first, then other materials in the same course (if available).
      const materials: { id: string; course_payload: CoursePayload }[] = [
        { id: b.materialId, course_payload: payload! },
      ];
      if (courseId) {
        const { data: otherMats } = await supabase
          .from("study_materials")
          .select("id, course_payload")
          .eq("course_id", courseId)
          .order("created_at", { ascending: true });
        for (const om of otherMats ?? []) {
          if (!om?.id || om.id === b.materialId) continue;
          const pl = om.course_payload as CoursePayload | null;
          if (pl && Array.isArray((pl as CoursePayload).modules) && pl.modules.length > 0) {
            materials.push({ id: om.id, course_payload: pl });
          }
        }
      }

      const loc = findBestStudyLocationForQuery({
        materials,
        query: last.content,
      });
      if (loc) {
        fallbackAction = {
          type: "navigate_to_location",
          materialId: loc.materialId,
          moduleId: loc.moduleId,
          reason: loc.reason,
        };
      }
    }

    const out = await runStudyChat(contextText, messages);
    let action: unknown | null = out.action ?? null;

    if (hasStructuredCourse && action && typeof action === "object") {
      const a = action as { type?: unknown; query?: unknown; moduleId?: unknown };
      if (a.type === "navigate_by_query" && typeof a.query === "string") {
        const hit = findBestModuleIdForQuery(payload!, a.query);
        action = hit
          ? { type: "navigate_to_module", moduleId: hit.moduleId, reason: hit.reason }
          : null;
      }

      if (a.type === "navigate_to_module") {
        const modId = typeof a.moduleId === "number" ? a.moduleId : Number.NaN;
        const ok = Number.isFinite(modId) && payload!.modules.some((m) => m.id === modId);
        if (!ok) action = null;
      }
    }

    if (!action && fallbackAction) {
      action = fallbackAction;
    }

    return NextResponse.json({ reply: out.reply, action });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Could not get a response. Try again." },
      { status: 502 }
    );
  }
}
