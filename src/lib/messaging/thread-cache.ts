import { conversationTitle } from "@/lib/messaging/display-name";
import type { ConversationMember, FriendProfile, MessageRow } from "@/lib/messaging/types";

export type ConversationMeta = {
  title: string;
  courseId: string | null;
  courseTitle: string | null;
  isGroup: boolean;
  members: ConversationMember[];
};

const metaCache = new Map<string, ConversationMeta>();
const messagesCache = new Map<string, MessageRow[]>();
const inflightMeta = new Map<string, Promise<ConversationMeta | null>>();

export function getCachedMeta(conversationId: string): ConversationMeta | undefined {
  return metaCache.get(conversationId);
}

export function getCachedMessages(conversationId: string): MessageRow[] | undefined {
  return messagesCache.get(conversationId);
}

export function setCachedMessages(conversationId: string, messages: MessageRow[]): void {
  messagesCache.set(conversationId, messages);
}

export function invalidateConversationMeta(conversationId: string): void {
  metaCache.delete(conversationId);
  inflightMeta.delete(conversationId);
}

export function setCachedMeta(conversationId: string, meta: ConversationMeta): void {
  metaCache.set(conversationId, meta);
}

export function appendCachedMessage(conversationId: string, message: MessageRow): void {
  const prev = messagesCache.get(conversationId) ?? [];
  if (prev.some((m) => m.id === message.id)) return;
  messagesCache.set(conversationId, [...prev, message]);
}

export async function prefetchConversationMeta(
  conversationId: string
): Promise<ConversationMeta | null> {
  const hit = metaCache.get(conversationId);
  if (hit) return hit;

  const pending = inflightMeta.get(conversationId);
  if (pending) return pending;

  const task = (async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.conversation) return null;
      const c = body.conversation as {
        title: string | null;
        courseId: string | null;
        courseTitle: string | null;
        isGroup: boolean;
        participants: FriendProfile[];
        members?: ConversationMember[];
      };
      const meta: ConversationMeta = {
        title: conversationTitle(c.isGroup, c.title, c.participants),
        courseId: c.courseId,
        courseTitle: c.courseTitle ?? null,
        isGroup: c.isGroup,
        members: c.members ?? [],
      };
      metaCache.set(conversationId, meta);
      return meta;
    } catch {
      return null;
    } finally {
      inflightMeta.delete(conversationId);
    }
  })();

  inflightMeta.set(conversationId, task);
  return task;
}

export async function prefetchMessages(conversationId: string): Promise<void> {
  if (messagesCache.has(conversationId)) return;
  try {
    const res = await fetch(`/api/conversations/${conversationId}/messages`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.messages)) {
      messagesCache.set(conversationId, body.messages);
    }
  } catch {
    /* ignore */
  }
}
