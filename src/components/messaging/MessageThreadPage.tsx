"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { MessageThread } from "@/components/messaging/MessageThread";
import { dispatchMessagingRefresh } from "@/lib/messaging/realtime";
import {
  getCachedMeta,
  invalidateConversationMeta,
  prefetchConversationMeta,
  type ConversationMeta,
} from "@/lib/messaging/thread-cache";

type Props = {
  conversationId: string;
  onBack?: () => void;
  embedded?: boolean;
};

function MessageThreadPageInner({ conversationId, onBack, embedded }: Props) {
  const [meta, setMeta] = useState<ConversationMeta | null>(
    () => getCachedMeta(conversationId) ?? null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hit = getCachedMeta(conversationId);
    if (hit) {
      setMeta(hit);
      setError(null);
      return;
    }

    let cancelled = false;
    setMeta(null);
    void prefetchConversationMeta(conversationId).then((next) => {
      if (cancelled) return;
      if (next) {
        setMeta(next);
        setError(null);
      } else {
        setError("Could not load conversation.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const refreshMeta = useCallback(() => {
    invalidateConversationMeta(conversationId);
    void prefetchConversationMeta(conversationId).then((next) => {
      if (next) setMeta(next);
    });
    dispatchMessagingRefresh();
  }, [conversationId]);

  const handleLeave = useCallback(() => {
    invalidateConversationMeta(conversationId);
    dispatchMessagingRefresh();
    onBack?.();
  }, [conversationId, onBack]);

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
      onMembersChange={refreshMeta}
      onLeave={handleLeave}
    />
  );
}

export const MessageThreadPage = memo(MessageThreadPageInner);
