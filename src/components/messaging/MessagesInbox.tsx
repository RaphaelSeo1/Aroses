"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  conversationTitle,
  friendDisplayName,
} from "@/lib/messaging/display-name";
import {
  dispatchMessagingRefresh,
  MESSAGING_REFRESH_EVENT,
} from "@/lib/messaging/realtime";
import type { ConversationListItem } from "@/lib/messaging/types";
import { createClient } from "@/lib/supabase/client";

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MessagesInbox({
  onSelectConversation,
  friendsHref = "/friends",
}: {
  onSelectConversation?: (conversationId: string) => void;
  friendsHref?: string;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setConversations(body.conversations ?? []);
        setError(null);
      } else {
        setError(typeof body.error === "string" ? body.error : "Could not load inbox.");
      }
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void load();

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      channel = supabase
        .channel(`inbox:${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          () => {
            void load();
            dispatchMessagingRefresh();
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations" },
          () => {
            void load();
          }
        )
        .subscribe();
    })();

    const onRefresh = () => void load();
    window.addEventListener(MESSAGING_REFRESH_EVENT, onRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener(MESSAGING_REFRESH_EVENT, onRefresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Messages with friends.
        </p>
        <Link
          href={friendsHref}
          className="shrink-0 rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
        >
          Friends
        </Link>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-zinc-400">Loading…</p>
      ) : conversations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No conversations yet.</p>
          <Link href={friendsHref} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
            Add friends to start messaging →
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {conversations.map((c) => {
            const title = conversationTitle(c.isGroup, c.title, c.participants);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() =>
                    onSelectConversation
                      ? onSelectConversation(c.id)
                      : router.push(`/messages/${c.id}`)
                  }
                  className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/80"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold dark:bg-zinc-800">
                    {c.isGroup ? "#" : friendDisplayName(c.participants[0] ?? { id: "", displayName: null, username: null, avatarUrl: null }).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">{title}</p>
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        {formatWhen(c.lastMessageAt)}
                      </span>
                    </div>
                    {c.courseTitle ? (
                      <p className="mt-0.5 text-[11px] text-indigo-600 dark:text-indigo-400">
                        {c.courseTitle}
                      </p>
                    ) : null}
                    <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {c.lastMessagePreview ?? "No messages yet"}
                    </p>
                  </div>
                  {c.unreadCount > 0 ? (
                    <span className="mt-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
