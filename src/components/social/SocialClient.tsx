"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FriendsApp } from "@/components/messaging/FriendsApp";
import { MessagingWorkspace } from "@/components/messaging/MessagingWorkspace";
import { useT } from "@/lib/i18n/LocaleProvider";
import {
  formatBadgeCount,
  useSocialBadgeCounts,
} from "@/lib/social-badge";
import {
  replaceSocialUrl,
  socialFriendsHref,
} from "@/lib/messaging/social-url";

type SocialTab = "friends" | "messages";

function tabFromSearch(raw: string | null): SocialTab {
  return raw === "messages" ? "messages" : "friends";
}

export function SocialClient({
  initialSocialCounts,
}: {
  initialSocialCounts?: {
    unreadMessages: number;
    pendingFriendRequests: number;
    total: number;
  } | null;
}) {
  const t = useT();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SocialTab>(() =>
    tabFromSearch(searchParams.get("tab"))
  );
  const [conversationId, setConversationId] = useState<string | null>(() =>
    searchParams.get("conversation")
  );
  const { counts } = useSocialBadgeCounts({
    initialCounts: initialSocialCounts,
  });

  useEffect(() => {
    setTab(tabFromSearch(searchParams.get("tab")));
    setConversationId(searchParams.get("conversation"));
  }, [searchParams]);

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

  const unreadBadge = formatBadgeCount(counts.unreadMessages);
  const friendsBadge = formatBadgeCount(counts.pendingFriendRequests);

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
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === "friends"
              ? "bg-brand text-white shadow-sm"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {t.social.tabFriends}
          {counts.pendingFriendRequests > 0 ? (
            <span
              className={`inline-flex min-w-[1.15rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
                tab === "friends"
                  ? "bg-white/20 text-white"
                  : "bg-brand text-white"
              }`}
            >
              {friendsBadge}
            </span>
          ) : null}
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
          {counts.unreadMessages > 0 ? (
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
