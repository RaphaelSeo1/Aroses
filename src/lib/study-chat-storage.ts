import type { StudyChatTurn } from "@/types/study-chat";

export const MAX_STORED_MESSAGES = 24;

export function studyChatStorageKey(
  courseId?: string,
  materialId?: string,
  moduleId?: number | string
): string {
  const hasModule =
    moduleId !== undefined && moduleId !== null && `${moduleId}`.trim() !== "";
  if (courseId) {
    return hasModule
      ? `aroses-study-chat:course:${courseId}:module:${moduleId}`
      : `aroses-study-chat:course:${courseId}`;
  }
  if (materialId) {
    return hasModule
      ? `aroses-study-chat:material:${materialId}:module:${moduleId}`
      : `aroses-study-chat:material:${materialId}`;
  }
  return "aroses-study-chat:anonymous";
}

export function loadStudyChatMessages(key: string): StudyChatTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StudyChatTurn[] = [];
    for (const m of parsed) {
      if (
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
      ) {
        out.push({ role: m.role, content: m.content.trim() });
      }
    }
    return out.slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

export function saveStudyChatMessages(key: string, messages: StudyChatTurn[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = messages.slice(-MAX_STORED_MESSAGES);
    window.localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or private mode — ignore.
  }
}
