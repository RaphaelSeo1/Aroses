import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { enterAiUsageContext } from "@/lib/billing/ai-usage";
import {
  buildLegacyStudyContext,
  buildStudyContextText,
  runStudyChat,
} from "@/lib/ai/study-chat";
import { loadStudyContextForMaterial } from "@/lib/load-course-study-context";
import { sanitizeStudyChatReply } from "@/lib/ai/study-chat-parse";
import {
  fetchCourseMaterialsForChat,
  buildCourseMapFromMaterials,
} from "@/lib/study-chat-context";
import {
  extractNavigationQuery,
  findAllStudyLocationsForQuery,
  isUnambiguousNavigation,
} from "@/lib/study-chat-nav";
import { buildNavigationOptions } from "@/lib/study-chat-options";
import { parseChatAttachments } from "@/lib/chat/chat-attachment-parse";
import type { StudyChatOption, StudyChatTurn } from "@/types/study-chat";
import type { CoursePayload } from "@/types/course";
import type { MCQuestion } from "@/types/study";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_CONTENT_PER_MESSAGE = 8000;
// Rolling context window (turns). Instead of hard-rejecting once a conversation
// grows past this, we keep only the most recent turns so Ask Rose never stops
// working mid-conversation. Bounds cost/latency while staying invisible to the
// student.
const MAX_MESSAGES = 40;

/**
 * Keep only the most recent `max` turns and guarantee the window starts on a
 * user turn (Anthropic requires the first message in the array to be `user`).
 * This lets long conversations continue seamlessly rather than erroring out.
 */
function trimToConversationWindow(
  messages: StudyChatTurn[],
  max: number
): StudyChatTurn[] {
  let windowed = messages.length > max ? messages.slice(-max) : messages;
  while (windowed.length > 0 && windowed[0].role !== "user") {
    windowed = windowed.slice(1);
  }
  return windowed;
}

/**
 * Only TRUE for an explicit "take me there" request. Plain questions — even ones
 * that contain words like "where", "find", or "which module" — must NOT count as
 * navigation, because Rose's primary job is to ANSWER them, not ship the student
 * off to a course page.
 */
function looksLikeNavigationIntent(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    t.includes("take me") ||
    t.includes("go to") ||
    t.includes("jump to") ||
    t.includes("send me") ||
    t.includes("bring me") ||
    t.includes("navigate") ||
    /\bopen (the )?module\b/.test(t) ||
    /\bopen (the )?lesson\b/.test(t) ||
    /\bshow me (the )?module\b/.test(t)
  );
}

function materialLabelsFrom(
  materials: { id: string; label: string }[]
): Map<string, string> {
  return new Map(materials.map((m) => [m.id, m.label]));
}

function resolveNavigateAction(
  action: unknown,
  navMaterials: { id: string; course_payload: CoursePayload; label: string }[]
): unknown | null {
  if (!action || typeof action !== "object") return null;
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
    return pick
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
    const host = navMaterials.find((m) =>
      m.course_payload.modules.some((mod) => mod.id === modId)
    );
    if (!host || !Number.isFinite(modId)) return null;
    return {
      type: "navigate_to_location",
      materialId: host.id,
      moduleId: modId,
      reason: (a as { reason?: string }).reason,
    };
  }

  if (a.type === "navigate_to_location") {
    const matId = typeof a.materialId === "string" ? a.materialId : "";
    const modId = typeof a.moduleId === "number" ? a.moduleId : Number.NaN;
    const host = navMaterials.find((m) => m.id === matId);
    const ok =
      host &&
      Number.isFinite(modId) &&
      host.course_payload.modules.some((mod) => mod.id === modId);
    return ok ? action : null;
  }

  return null;
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  enterAiUsageContext({ userId: user.id, feature: "study-chat" });

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
    attachedPdfText?: unknown;
    attachedPdfName?: unknown;
    attachedFiles?: unknown;
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

  const validated: StudyChatTurn[] = [];
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
    validated.push({ role: m.role, content: m.content.trim() });
  }

  // Long conversations don't error — keep a rolling window of recent turns so
  // the newest question is always answered (the last turn is preserved below).
  const messages = trimToConversationWindow(validated, MAX_MESSAGES);

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

  const attached = parseChatAttachments(b);
  if (attached.text) {
    contextText += `\n\n=== ATTACHED FILE${attached.name ? ` (${attached.name})` : ""} ===\n${attached.text}\nPrefer this attached file when the student asks about it, a worksheet, or "this PDF" / "this doc" / "this image".\n`;
  }

  try {
    const navMaterials =
      courseMaterials.length > 0
        ? courseMaterials
        : [{ id: b.materialId, course_payload: payload!, label: "Current upload" }];
    const labels = materialLabelsFrom(navMaterials);

    const explicitNavIntent =
      hasStructuredCourse && looksLikeNavigationIntent(last.content);

    // User picked a numbered option from a prior turn ("2" / "module 2" / label text).
    const pickMatchTest = last.content.match(/^module\s*(\d+)\s*[:.\-]?\s*(.*)$/i);
    const pickedNumberedOption = hasStructuredCourse && pickMatchTest !== null;

    // Navigation is OPTIONAL: only resolve locations when the student EXPLICITLY
    // asked to go somewhere (or tapped a numbered option). Otherwise we fall
    // straight through to runStudyChat so Rose actually answers the question.
    const wantsNavigation = explicitNavIntent || pickedNumberedOption;

    const navQuery = wantsNavigation ? extractNavigationQuery(last.content) : "";
    let navMatches =
      wantsNavigation && hasStructuredCourse
        ? findAllStudyLocationsForQuery({
            materials: navMaterials,
            query: navQuery || last.content,
          })
        : [];

    // User picked a numbered option from a prior turn ("2" / "module 2" / label text).
    if (wantsNavigation && hasStructuredCourse && navMatches.length === 0) {
      const pickMatch = pickMatchTest;
      if (pickMatch) {
        const modNum = Number.parseInt(pickMatch[1]!, 10);
        if (Number.isFinite(modNum)) {
          navMatches = findAllStudyLocationsForQuery({
            materials: navMaterials,
            query: pickMatch[2]?.trim() || " ",
          }).filter((m) => m.moduleId === modNum);
          if (navMatches.length === 0) {
            for (const mat of navMaterials) {
              if (mat.course_payload.modules.some((mod) => mod.id === modNum)) {
                navMatches = [
                  {
                    materialId: mat.id,
                    moduleId: modNum,
                    moduleTitle:
                      mat.course_payload.modules.find((mod) => mod.id === modNum)
                        ?.title ?? `Module ${modNum}`,
                    reason: "You picked this module.",
                    score: 100,
                  },
                ];
                break;
              }
            }
          }
        }
      }
    }

    const navIntent = wantsNavigation && hasStructuredCourse;

    if (navIntent && navMatches.length > 0) {
      const options = buildNavigationOptions({
        matches: navMatches,
        materialLabels: labels,
        currentMaterialId: b.materialId,
        currentModuleId: moduleId,
      });
      const pick = isUnambiguousNavigation(navMatches);
      const topic = navQuery || extractNavigationQuery(last.content) || "that topic";

      if (pick) {
        return NextResponse.json({
          reply: `Taking you to **${pick.moduleTitle}**${labels.size > 1 ? ` (${labels.get(pick.materialId) ?? "course upload"})` : ""}.`,
          action: {
            type: "navigate_to_location",
            materialId: pick.materialId,
            moduleId: pick.moduleId,
            reason: pick.reason,
          },
          options: options.filter(
            (o) =>
              o.action.type === "navigate_to_location" &&
              o.action.materialId === pick.materialId &&
              o.action.moduleId === pick.moduleId
          ),
        });
      }

      return NextResponse.json({
        reply: `I found **${navMatches.length}** places about "${topic}" across your course (${labels.size} upload${labels.size === 1 ? "" : "s"}). Tap the one you want:`,
        action: null,
        options,
      });
    }

    // Explicit nav request but nothing matched: don't dead-end. Fall through so
    // Rose actually answers/helps (and may still surface a navigation suggestion).

    const studyContext = await loadStudyContextForMaterial(
      supabase,
      b.materialId
    );
    const out = await runStudyChat(
      contextText,
      messages,
      studyContext ?? undefined
    );
    let reply = sanitizeStudyChatReply(out.reply);
    let action = resolveNavigateAction(out.action, navMaterials);
    let options: StudyChatOption[] = [];

    const resolvedAction = action as {
      type?: string;
      materialId?: string;
      moduleId?: number;
      reason?: string;
    } | null;

    if (resolvedAction?.type === "navigate_to_location") {
      const loc = resolvedAction as {
        materialId: string;
        moduleId: number;
        reason?: string;
      };
      const mod = navMaterials
        .find((m) => m.id === loc.materialId)
        ?.course_payload.modules.find((m) => m.id === loc.moduleId);
      options = buildNavigationOptions({
        matches: [
          {
            materialId: loc.materialId,
            moduleId: loc.moduleId,
            moduleTitle: mod?.title ?? `Module ${loc.moduleId}`,
            reason: loc.reason ?? "",
            score: 100,
          },
        ],
        materialLabels: labels,
        currentMaterialId: b.materialId,
        currentModuleId: moduleId,
      });
    } else if (
      out.action &&
      typeof out.action === "object" &&
      (out.action as { type?: string }).type === "navigate_by_query" &&
      typeof (out.action as { query?: string }).query === "string"
    ) {
      const q = (out.action as { query: string }).query;
      const matches = findAllStudyLocationsForQuery({
        materials: navMaterials,
        query: q,
      });
      const pick = isUnambiguousNavigation(matches);
      options = buildNavigationOptions({
        matches,
        materialLabels: labels,
        currentMaterialId: b.materialId,
        currentModuleId: moduleId,
      });
      if (pick) {
        action = {
          type: "navigate_to_location",
          materialId: pick.materialId,
          moduleId: pick.moduleId,
          reason: pick.reason,
        };
      } else if (matches.length > 1) {
        action = null;
        reply = sanitizeStudyChatReply(
          reply || `I found ${matches.length} matches for "${q}". Pick one:`
        );
      } else {
        action = null;
      }
    }

    return NextResponse.json({ reply, action, options });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Could not get a response. Try again." },
      { status: 502 }
    );
  }
}
