"use client";

import { useEffect, useState } from "react";
import { MessageThread } from "@/components/messaging/MessageThread";
import {
  conversationTitle,
} from "@/lib/messaging/display-name";
import type { ConversationMember, FriendProfile } from "@/lib/messaging/types";

type Props = {
  conversationId: string;
  onBack?: () => void;
};

export function MessageThreadPage({ conversationId, onBack }: Props) {
  const [meta, setMeta] = useState<{
    title: string;
    courseId: string | null;
    isGroup: boolean;
    members: ConversationMember[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok && body.conversation) {
            const c = body.conversation as {
              title: string | null;
              courseId: string | null;
              isGroup: boolean;
              participants: FriendProfile[];
              members?: ConversationMember[];
            };
            setMeta({
              title: conversationTitle(c.isGroup, c.title, c.participants),
              courseId: c.courseId,
              isGroup: c.isGroup,
              members: c.members ?? [],
            });
          } else {
            setError(typeof body.error === "string" ? body.error : "Could not load conversation.");
          }
        }
      } catch {
        if (!cancelled) setError("Network error.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!meta) {
    return <p className="py-12 text-center text-sm text-zinc-400">Loading conversation…</p>;
  }

  return (
    <MessageThread
      conversationId={conversationId}
      title={meta.title}
      courseId={meta.courseId}
      isGroup={meta.isGroup}
      members={meta.members}
      onBack={onBack}
    />
  );
}
