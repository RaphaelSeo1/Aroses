import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/** Find an existing 1:1 thread between two users. */
export async function findDirectConversation(
  userA: string,
  userB: string
): Promise<string | null> {
  const admin = createAdminClient();
  const client = admin;
  if (!client) return null;

  const { data: convs } = await client
    .from("conversations")
    .select("id")
    .eq("type", "direct");

  for (const conv of convs ?? []) {
    const { data: parts } = await client
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

export async function createDirectConversation(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<{ id: string } | null> {
  const existing = await findDirectConversation(userId, otherUserId);
  if (existing) return { id: existing };

  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({
      type: "direct",
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !conv) return null;

  const admin = createAdminClient();
  const writer = admin ?? supabase;

  const { error: partErr } = await writer.from("conversation_participants").insert([
    { conversation_id: conv.id, user_id: userId, role: "member" },
    { conversation_id: conv.id, user_id: otherUserId, role: "member" },
  ]);

  if (partErr) {
    console.error("[createDirectConversation]", partErr);
    return null;
  }

  return { id: conv.id };
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
