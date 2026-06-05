import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/** Find an existing 1:1 thread between two users. */
export async function findDirectConversation(
  supabase: SupabaseClient,
  userA: string,
  userB: string
): Promise<string | null> {
  const { data: memberships, error: memErr } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userA);

  if (memErr || !memberships?.length) return null;

  const convIds = memberships.map((m) => m.conversation_id);

  const { data: convs } = await supabase
    .from("conversations")
    .select("id")
    .in("id", convIds)
    .eq("type", "direct");

  for (const conv of convs ?? []) {
    const { data: parts } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conv.id);

    const ids = new Set((parts ?? []).map((p) => p.user_id));
    if (ids.size === 2 && ids.has(userA) && ids.has(userB)) {
      return conv.id;
    }
  }
  return null;
}

async function addDirectParticipants(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  otherUserId: string
): Promise<boolean> {
  const admin = createAdminClient();
  if (admin) {
    const { error } = await admin.from("conversation_participants").insert([
      { conversation_id: conversationId, user_id: userId, role: "member" },
      { conversation_id: conversationId, user_id: otherUserId, role: "member" },
    ]);
    if (!error) return true;
    console.error("[createDirectConversation] admin participants", error);
  }

  const { error: selfErr } = await supabase.from("conversation_participants").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "member",
  });
  if (selfErr) {
    console.error("[createDirectConversation] self participant", selfErr);
    return false;
  }

  const { error: otherErr } = await supabase.from("conversation_participants").insert({
    conversation_id: conversationId,
    user_id: otherUserId,
    role: "member",
  });
  if (otherErr) {
    console.error("[createDirectConversation] other participant", otherErr);
    return false;
  }

  return true;
}

async function addGroupParticipants(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  memberIds: string[]
): Promise<boolean> {
  const admin = createAdminClient();
  const rows = [
    { conversation_id: conversationId, user_id: userId, role: "admin" as const },
    ...memberIds.map((id) => ({
      conversation_id: conversationId,
      user_id: id,
      role: "member" as const,
    })),
  ];

  if (admin) {
    const { error } = await admin.from("conversation_participants").insert(rows);
    if (!error) return true;
    console.error("[createGroupConversation] admin participants", error);
  }

  const { error: selfErr } = await supabase.from("conversation_participants").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "admin",
  });
  if (selfErr) {
    console.error("[createGroupConversation] self participant", selfErr);
    return false;
  }

  for (const memberId of memberIds) {
    const { error: memberErr } = await supabase.from("conversation_participants").insert({
      conversation_id: conversationId,
      user_id: memberId,
      role: "member",
    });
    if (memberErr) {
      console.error("[createGroupConversation] member participant", memberId, memberErr);
      return false;
    }
  }

  return true;
}

export async function createGroupConversation(
  supabase: SupabaseClient,
  userId: string,
  input: { title: string; memberIds: string[]; courseId?: string | null }
): Promise<{ id: string } | null> {
  const conversationId = randomUUID();

  const { error: convErr } = await supabase.from("conversations").insert({
    id: conversationId,
    type: "group",
    title: input.title,
    course_id: input.courseId ?? null,
    created_by: userId,
  });

  if (convErr) {
    console.error("[createGroupConversation] conversation", convErr);
    return null;
  }

  const ok = await addGroupParticipants(supabase, conversationId, userId, input.memberIds);
  if (!ok) return null;

  return { id: conversationId };
}

export async function createDirectConversation(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<{ id: string } | null> {
  const existing = await findDirectConversation(supabase, userId, otherUserId);
  if (existing) return { id: existing };

  const conversationId = randomUUID();

  const { error: convErr } = await supabase.from("conversations").insert({
    id: conversationId,
    type: "direct",
    created_by: userId,
  });

  if (convErr) {
    console.error("[createDirectConversation] conversation", convErr);
    return null;
  }

  const ok = await addDirectParticipants(supabase, conversationId, userId, otherUserId);
  if (!ok) return null;

  return { id: conversationId };
}

export async function buildContextLabel(
  supabase: SupabaseClient,
  input: {
    courseId?: string | null;
    materialId?: string | null;
    moduleId?: number | null;
    lessonIndex?: number | null;
  }
): Promise<string | null> {
  const parts: string[] = [];
  if (input.courseId) {
    const { data: course } = await supabase
      .from("courses")
      .select("title")
      .eq("id", input.courseId)
      .maybeSingle();
    if (course?.title) parts.push(course.title);
  }
  if (input.materialId) {
    const { data: mat } = await supabase
      .from("study_materials")
      .select("file_name")
      .eq("id", input.materialId)
      .maybeSingle();
    if (mat?.file_name) parts.push(mat.file_name);
  }
  if (typeof input.moduleId === "number") {
    parts.push(`Module ${input.moduleId + 1}`);
  }
  if (typeof input.lessonIndex === "number") {
    parts.push(`Lesson ${input.lessonIndex + 1}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
