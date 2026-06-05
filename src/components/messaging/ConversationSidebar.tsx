"use client";

import Link from "next/link";
import { useState } from "react";
import { AddGroupMembersModal } from "@/components/messaging/AddGroupMembersModal";
import { friendDisplayName } from "@/lib/messaging/display-name";
import type { ConversationMember } from "@/lib/messaging/types";

type Props = {
  conversationId: string;
  isGroup: boolean;
  members: ConversationMember[];
  courseId?: string | null;
  courseTitle?: string | null;
  canManageMembers?: boolean;
  onMembersChange?: () => void;
  onLeave?: () => void;
};

function MemberAvatar({ member }: { member: ConversationMember }) {
  const label = friendDisplayName(member);
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        label.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

export function ConversationSidebar({
  conversationId,
  isGroup,
  members,
  courseId,
  courseTitle,
  canManageMembers = false,
  onMembersChange,
  onLeave,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!isGroup && members.length <= 1) return null;

  const aboutText = isGroup
    ? courseTitle
      ? `Study group for ${courseTitle}.`
      : `Group chat with ${members.length} members.`
    : null;

  const memberIds = new Set(members.map((m) => m.id));

  async function removeMember(userId: string) {
    setRemovingId(userId);
    setActionError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/participants`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(typeof body.error === "string" ? body.error : "Could not remove member.");
      } else {
        onMembersChange?.();
      }
    } catch {
      setActionError("Network error.");
    }
    setRemovingId(null);
  }

  async function leaveGroup() {
    if (!confirm("Leave this group? You won't see new messages unless someone adds you back.")) {
      return;
    }
    setLeaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/participants`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(typeof body.error === "string" ? body.error : "Could not leave group.");
        setLeaving(false);
      } else {
        onLeave?.();
      }
    } catch {
      setActionError("Network error.");
      setLeaving(false);
    }
  }

  return (
    <>
      <aside className="flex w-full shrink-0 flex-col border-t border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30 lg:w-56 lg:border-l lg:border-t-0 xl:w-64">
        {isGroup && aboutText ? (
          <section className="border-b border-zinc-100 px-4 py-4 dark:border-zinc-800">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              About
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {aboutText}
            </p>
            {courseId ? (
              <Link
                href={`/dashboard/courses/${courseId}`}
                className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
              >
                Open course →
              </Link>
            ) : null}
          </section>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              {isGroup ? `Members — ${members.length}` : "Chat"}
            </h2>
            {isGroup && canManageMembers ? (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="text-[10px] font-semibold uppercase tracking-wide text-brand hover:underline"
              >
                Add
              </button>
            ) : null}
          </div>

          {!isGroup && members.length === 1 ? (
            <div className="mt-3 flex items-center gap-3">
              <MemberAvatar member={members[0]!} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {friendDisplayName(members[0]!)}
                </p>
                {members[0]!.username ? (
                  <p className="truncate text-xs text-zinc-500">@{members[0]!.username}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <ul className="mt-2 -mx-1 flex-1 space-y-0.5 overflow-y-auto">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/80 dark:hover:bg-zinc-800/60"
                >
                  <MemberAvatar member={member} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {friendDisplayName(member)}
                      {member.isSelf ? (
                        <span className="ml-1 font-normal text-zinc-500">(you)</span>
                      ) : null}
                    </p>
                    {member.username ? (
                      <p className="truncate text-xs text-zinc-500">@{member.username}</p>
                    ) : null}
                  </div>
                  {member.role === "admin" ? (
                    <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand">
                      Admin
                    </span>
                  ) : null}
                  {isGroup && canManageMembers && !member.isSelf ? (
                    <button
                      type="button"
                      disabled={removingId === member.id}
                      onClick={() => void removeMember(member.id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title="Remove from group"
                    >
                      {removingId === member.id ? "…" : "Remove"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {actionError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>
          ) : null}
        </section>

        {isGroup ? (
          <section className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            {canManageMembers ? (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Add members
              </button>
            ) : null}
            <button
              type="button"
              disabled={leaving}
              onClick={() => void leaveGroup()}
              className="w-full rounded-lg border border-red-200/80 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              {leaving ? "Leaving…" : "Leave group"}
            </button>
          </section>
        ) : null}
      </aside>

      {addOpen ? (
        <AddGroupMembersModal
          conversationId={conversationId}
          memberIds={memberIds}
          onClose={() => setAddOpen(false)}
          onAdded={() => onMembersChange?.()}
        />
      ) : null}
    </>
  );
}
