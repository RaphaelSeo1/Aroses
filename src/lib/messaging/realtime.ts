export const MESSAGING_REFRESH_EVENT = "aroses-messaging-refresh";

export function dispatchMessagingRefresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MESSAGING_REFRESH_EVENT));
  }
}

export type DbMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sender_display_name: string | null;
  sender_username: string | null;
  context_course_id: string | null;
  context_material_id: string | null;
  context_module_id: number | null;
  context_lesson_index: number | null;
  context_label: string | null;
  created_at: string;
};

export function mapDbMessageToRow(row: DbMessageRow, userId: string) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    senderDisplayName: row.sender_display_name,
    senderUsername: row.sender_username,
    contextCourseId: row.context_course_id,
    contextMaterialId: row.context_material_id,
    contextModuleId: row.context_module_id,
    contextLessonIndex: row.context_lesson_index,
    contextLabel: row.context_label,
    createdAt: row.created_at,
    isOwn: row.sender_id === userId,
  };
}
