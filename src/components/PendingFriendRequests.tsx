"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { friendDisplayName } from "@/lib/messaging/display-name";
import { dispatchMessagingRefresh } from "@/lib/messaging/realtime";
import { socialFriendsHref } from "@/lib/messaging/social-url";
import type { FriendshipListItem } from "@/lib/messaging/types";

/**
 * Home-page banner for incoming friend requests (same pattern as course invites).
 */
export function PendingFriendRequests() {
  const t = useT();
  const [incoming, setIncoming] = useState<FriendshipListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/friends");
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setIncoming((body.incoming ?? []) as FriendshipListItem[]);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || incoming.length === 0) return null;

  async function respond(id: string, action: "accept" | "decline") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/friends/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setIncoming((prev) => prev.filter((i) => i.id !== id));
        dispatchMessagingRefresh();
      }
    } catch {
      /* ignore */
    }
    setBusyId(null);
  }

  return (
    <section className="mb-6 rounded-2xl border border-brand/20 bg-brand/5 p-4 dark:border-brand/30 dark:bg-brand/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t.social.friendRequestsTitle}
        </p>
        <Link
          href={socialFriendsHref()}
          className="text-xs font-medium text-brand hover:underline dark:text-brand-soft"
        >
          {t.social.openSocial}
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {incoming.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-white/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/80"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {friendDisplayName(item.friend)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {item.friend.username
                  ? `@${item.friend.username}`
                  : t.social.friendRequestHint}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void respond(item.id, "decline")}
                className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t.messages.decline}
              </button>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void respond(item.id, "accept")}
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {t.messages.accept}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {incoming.length > 1 ? (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {tf(t.social.friendRequestsCount, { count: incoming.length })}
        </p>
      ) : null}
    </section>
  );
}
