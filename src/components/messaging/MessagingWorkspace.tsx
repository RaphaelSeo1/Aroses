"use client";

import { memo } from "react";
import { MessageThreadPage } from "@/components/messaging/MessageThreadPage";
import { MessagesInbox } from "@/components/messaging/MessagesInbox";

type Props = {
  conversationId: string | null;
  onConversationChange: (conversationId: string | null) => void;
  friendsHref?: string;
};

function MessagingWorkspaceInner({
  conversationId,
  onConversationChange,
  friendsHref = "/dashboard/social?tab=friends",
}: Props) {
  return (
    <div className="flex min-h-[36rem] overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-inner dark:border-zinc-800 dark:bg-zinc-950">
      <aside
        className={`w-full shrink-0 border-r border-zinc-100 dark:border-zinc-800 sm:w-52 md:w-56 ${
          conversationId ? "hidden sm:flex sm:flex-col" : "flex flex-col"
        }`}
      >
        <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Inbox
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <MessagesInbox
            compact
            activeConversationId={conversationId}
            friendsHref={friendsHref}
            onSelectConversation={(id) => onConversationChange(id)}
          />
        </div>
      </aside>

      <main
        className={`min-w-0 flex-1 flex-col ${
          conversationId ? "flex" : "hidden sm:flex"
        }`}
      >
        {conversationId ? (
          <MessageThreadPage
            conversationId={conversationId}
            onBack={() => onConversationChange(null)}
            embedded
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Select a conversation
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Pick a chat from the inbox or start one from Friends.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export const MessagingWorkspace = memo(MessagingWorkspaceInner);
