"use client";

import { memo } from "react";
import { MessageThreadPage } from "@/components/messaging/MessageThreadPage";
import { MessagesInbox } from "@/components/messaging/MessagesInbox";

type Props = {
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onBackToInbox: () => void;
};

function MessagingWorkspaceInner({
  activeConversationId,
  onSelectConversation,
  onBackToInbox,
}: Props) {
  return (
    <div className="flex min-h-[32rem] overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-inner dark:border-zinc-800 dark:bg-zinc-950">
      <aside
        className={`w-full shrink-0 border-r border-zinc-100 dark:border-zinc-800 sm:w-56 md:w-64 ${
          activeConversationId ? "hidden sm:flex sm:flex-col" : "flex flex-col"
        }`}
      >
        <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Inbox
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <MessagesInbox
            compact
            activeConversationId={activeConversationId}
            friendsHref="/dashboard/profile?tab=friends"
            onSelectConversation={onSelectConversation}
          />
        </div>
      </aside>

      <main
        className={`min-w-0 flex-1 flex-col ${
          activeConversationId ? "flex" : "hidden sm:flex"
        }`}
      >
        {activeConversationId ? (
          <MessageThreadPage
            key={activeConversationId}
            conversationId={activeConversationId}
            onBack={onBackToInbox}
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
