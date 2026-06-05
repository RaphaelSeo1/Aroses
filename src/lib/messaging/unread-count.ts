import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchUnreadMessageCount(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: parts } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);

  if (!parts?.length) return 0;

  let total = 0;
  for (const part of parts) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", part.conversation_id)
      .neq("sender_id", userId)
      .gt("created_at", part.last_read_at);

    total += count ?? 0;
  }
  return total;
}
