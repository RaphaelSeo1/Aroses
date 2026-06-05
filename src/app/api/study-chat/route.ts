import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildLegacyStudyContext,
  buildStudyContextText,
  runStudyChat,
} from "@/lib/ai/study-chat";
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
  let courseMaterials: { id: string; course_payload: CoursePayload; label: string }[] =
    [];

  if (hasStructuredCourse) {
    const resolvedModuleId =
      moduleId ?? payload!.modules[0]?.id ?? 1;

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
    const navMaterials =
      courseMaterials.length > 0
        ? courseMaterials
        : [{ id: b.materialId, course_payload: payload!, label: "Current upload" }];

    if (hasStructuredCourse && looksLikeNavigationIntent(last.content)) {
      const navQuery = extractNavigationQuery(last.content);
      const matches = findAllStudyLocationsForQuery({
        materials: navMaterials,
        query: navQuery || last.content,
      });
      const pick = isUnambiguousNavigation(matches);
      if (pick) {
        fallbackAction = {
          type: "navigate_to_location",
          materialId: pick.materialId,
          moduleId: pick.moduleId,
          reason: pick.reason,
        };
      }
    }

    const out = await runStudyChat(contextText, messages);
    let action: unknown | null = out.action ?? null;

    if (hasStructuredCourse && action && typeof action === "object") {
      const a = action as {
        type?: unknown;
        query?: unknown;
        moduleId?: unknown;
        materialId?: unknown;
      };

      if (a.type === "navigate_by_query" && typeof a.query === "string") {
        const matches = findAllStudyLocationsForQuery({
          materials: navMaterials,
          query: a.query,
        });
        const pick = isUnambiguousNavigation(matches);
        action = pick
          ? {
              type: "navigate_to_location",
              materialId: pick.materialId,
              moduleId: pick.moduleId,
              reason: pick.reason,
            }
          : null;
      }

      if (a.type === "navigate_to_module") {
        const modId = typeof a.moduleId === "number" ? a.moduleId : Number.NaN;
        const ok =
          Number.isFinite(modId) &&
          navMaterials.some((m) =>
            m.course_payload.modules.some((mod) => mod.id === modId)
          );
        if (ok) {
          const host =
            navMaterials.find((m) =>
              m.course_payload.modules.some((mod) => mod.id === modId)
            ) ?? navMaterials[0]!;
          action = {
            type: "navigate_to_location",
            materialId: host.id,
            moduleId: modId,
            reason: (a as { reason?: string }).reason,
          };
        } else {
          action = null;
        }
      }

      if (a.type === "navigate_to_location") {
        const matId = typeof a.materialId === "string" ? a.materialId : "";
        const modId = typeof a.moduleId === "number" ? a.moduleId : Number.NaN;
        const host = navMaterials.find((m) => m.id === matId);
        const ok =
          host &&
          Number.isFinite(modId) &&
          host.course_payload.modules.some((mod) => mod.id === modId);
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
