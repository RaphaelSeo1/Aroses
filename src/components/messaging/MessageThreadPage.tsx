"use client";

import { memo, useEffect, useState } from "react";
import { MessageThread } from "@/components/messaging/MessageThread";
import { conversationTitle } from "@/lib/messaging/display-name";
import type { ConversationMember, FriendProfile } from "@/lib/messaging/types";

type Props = {
  conversationId: string;
  onBack?: () => void;
  embedded?: boolean;
};

const metaCache = new Map<
  string,
  {
    title: string;
    courseId: string | null;
    courseTitle: string | null;
    isGroup: boolean;
    members: ConversationMember[];
  }
>();

function MessageThreadPageInner({ conversationId, onBack, embedded }: Props) {
  const cached = metaCache.get(conversationId);
  const [meta, setMeta] = useState(cached ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hit = metaCache.get(conversationId);
    if (hit) {
      setMeta(hit);
      setError(null);
      return;
    }

    async function load() {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok && body.conversation) {
            const c = body.conversation as {
              title: string | null;
              courseId: string | null;
              courseTitle: string | null;
              isGroup: boolean;
              participants: FriendProfile[];
              members?: ConversationMember[];
            };
            const next = {
              title: conversationTitle(c.isGroup, c.title, c.participants),
              courseId: c.courseId,
              courseTitle: c.courseTitle ?? null,
              isGroup: c.isGroup,
              members: c.members ?? [],
            };
            metaCache.set(conversationId, next);
            setMeta(next);
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
    return <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!meta) {
    return <p className="py-12 text-center text-sm text-zinc-400">Loading conversation…</p>;
  }

  return (
    <MessageThread
      conversationId={conversationId}
      title={meta.title}
      courseId={meta.courseId}
      courseTitle={meta.courseTitle}
      isGroup={meta.isGroup}
      members={meta.members}
      onBack={onBack}
      embedded={embedded}
    />
  );
}

export const MessageThreadPage = memo(MessageThreadPageInner);
