import { NextResponse } from "next/server";
import {
  buildContextLabel,
  createDirectConversation,
} from "@/lib/messaging/conversations";
import { getSenderProfileBits } from "@/lib/messaging/profiles";
import type { MessageRow } from "@/lib/messaging/types";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ conversationId: string }> };

/** GET — message history (newest last). */
export async function GET(request: Request, ctx: Params) {
  const { conversationId } = await ctx.params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: allowed } = await supabase.rpc("is_conversation_participant", {
    p_conversation_id: conversationId,
    p_user_id: user.id,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(20, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50)
  );

  const { data: rows, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, sender_id, body, sender_display_name, sender_username, context_course_id, context_material_id, context_module_id, context_lesson_index, context_label, created_at"
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[messages GET]", error);
    return NextResponse.json({ error: "Could not load messages." }, { status: 500 });
  }

  const messages: MessageRow[] = (rows ?? []).map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    body: m.body,
    senderDisplayName: m.sender_display_name,
    senderUsername: m.sender_username,
    contextCourseId: m.context_course_id,
    contextMaterialId: m.context_material_id,
    contextModuleId: m.context_module_id,
    contextLessonIndex: m.context_lesson_index,
    contextLabel: m.context_label,
    createdAt: m.created_at,
    isOwn: m.sender_id === user.id,
  }));

  return NextResponse.json({ messages });
}

/** POST — send a message. */
export async function POST(request: Request, ctx: Params) {
  const { conversationId } = await ctx.params;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: allowed } = await supabase.rpc("is_conversation_participant", {
    p_conversation_id: conversationId,
    p_user_id: user.id,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const b = body as {
    body?: unknown;
    courseId?: unknown;
    materialId?: unknown;
    moduleId?: unknown;
    lessonIndex?: unknown;
  };

  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (text.length < 1 || text.length > 8000) {
    return NextResponse.json(
      { error: "Message must be 1–8000 characters." },
      { status: 400 }
    );
  }

  const contextCourseId =
    typeof b.courseId === "string" && UUID_RE.test(b.courseId) ? b.courseId : null;
  const contextMaterialId =
    typeof b.materialId === "string" && UUID_RE.test(b.materialId)
      ? b.materialId
      : null;
  const contextModuleId =
    typeof b.moduleId === "number" && Number.isInteger(b.moduleId) ? b.moduleId : null;
  const contextLessonIndex =
    typeof b.lessonIndex === "number" && Number.isInteger(b.lessonIndex)
      ? b.lessonIndex
      : null;

  const senderBits = await getSenderProfileBits(supabase, user.id);
  const contextLabel = await buildContextLabel(supabase, {
    courseId: contextCourseId,
    materialId: contextMaterialId,
    moduleId: contextModuleId,
    lessonIndex: contextLessonIndex,
  });

  const { data: msg, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: text,
      sender_display_name: senderBits.displayName,
      sender_username: senderBits.username,
      context_course_id: contextCourseId,
      context_material_id: contextMaterialId,
      context_module_id: contextModuleId,
      context_lesson_index: contextLessonIndex,
      context_label: contextLabel,
    })
    .select(
      "id, conversation_id, sender_id, body, sender_display_name, sender_username, context_course_id, context_material_id, context_module_id, context_lesson_index, context_label, created_at"
    )
    .single();

  if (error) {
    console.error("[messages POST]", error);
    return NextResponse.json({ error: "Could not send message." }, { status: 500 });
  }

  // TODO: push/email notification when configured.

  const message: MessageRow = {
    id: msg.id,
    conversationId: msg.conversation_id,
    senderId: msg.sender_id,
    body: msg.body,
    senderDisplayName: msg.sender_display_name,
    senderUsername: msg.sender_username,
    contextCourseId: msg.context_course_id,
    contextMaterialId: msg.context_material_id,
    contextModuleId: msg.context_module_id,
    contextLessonIndex: msg.context_lesson_index,
    contextLabel: msg.context_label,
    createdAt: msg.created_at,
    isOwn: true,
  };

  return NextResponse.json({ message });
}
