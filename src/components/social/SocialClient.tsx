"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FriendsApp } from "@/components/messaging/FriendsApp";
import { MessagingWorkspace } from "@/components/messaging/MessagingWorkspace";
import { useT } from "@/lib/i18n/LocaleProvider";
import { MESSAGING_REFRESH_EVENT } from "@/lib/messaging/realtime";
import {
  replaceSocialUrl,
  socialFriendsHref,
} from "@/lib/messaging/social-url";

type SocialTab = "friends" | "messages";

function tabFromSearch(raw: string | null): SocialTab {
  return raw === "messages" ? "messages" : "friends";
}

export function SocialClient() {
  const t = useT();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SocialTab>(() =>
    tabFromSearch(searchParams.get("tab"))
  );
  const [conversationId, setConversationId] = useState<string | null>(() =>
    searchParams.get("conversation")
  );
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    setTab(tabFromSearch(searchParams.get("tab")));
    setConversationId(searchParams.get("conversation"));
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    async function loadUnread() {
      try {
        const res = await fetch("/api/messages/unread-count");
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setUnreadMessages(typeof body.count === "number" ? body.count : 0);
        }
      } catch {
        /* ignore */
      }
    }
    void loadUnread();
    const onRefresh = () => void loadUnread();
    window.addEventListener(MESSAGING_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(MESSAGING_REFRESH_EVENT, onRefresh);
    };
  }, []);

  function goTab(next: SocialTab) {
    setTab(next);
    if (next === "messages") {
      replaceSocialUrl({ tab: "messages", conversation: conversationId });
    } else {
      replaceSocialUrl({ tab: "friends", conversation: null });
    }
  }

  function openConversation(id: string) {
    setTab("messages");
    setConversationId(id);
    replaceSocialUrl({ tab: "messages", conversation: id });
  }

  function onConversationChange(id: string | null) {
    setConversationId(id);
    replaceSocialUrl({ tab: "messages", conversation: id });
  }

  const unreadBadge = unreadMessages > 99 ? "99+" : String(unreadMessages);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.social.title}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t.social.subtitle}
        </p>
      </header>

      <div
        className="mb-6 inline-flex rounded-full border border-zinc-200/90 bg-white/95 p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90"
        role="tablist"
        aria-label={t.social.title}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "friends"}
          onClick={() => goTab("friends")}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === "friends"
              ? "bg-brand text-white shadow-sm"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {t.social.tabFriends}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "messages"}
          onClick={() => goTab("messages")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === "messages"
              ? "bg-brand text-white shadow-sm"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {t.social.tabMessages}
          {unreadMessages > 0 ? (
            <span
              className={`inline-flex min-w-[1.15rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
                tab === "messages"
                  ? "bg-white/20 text-white"
                  : "bg-brand text-white"
              }`}
            >
              {unreadBadge}
            </span>
          ) : null}
        </button>
      </div>

      {tab === "friends" ? (
        <FriendsApp embedded onOpenConversation={openConversation} />
      ) : (
        <MessagingWorkspace
          conversationId={conversationId}
          onConversationChange={onConversationChange}
          friendsHref={socialFriendsHref()}
        />
      )}
    </div>
  );
}
