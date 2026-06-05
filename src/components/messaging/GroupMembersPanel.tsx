"use client";

import { useState } from "react";
import { friendDisplayName } from "@/lib/messaging/display-name";
import type { ConversationMember } from "@/lib/messaging/types";

export function GroupMembersPanel({ members }: { members: ConversationMember[] }) {
  const [open, setOpen] = useState(false);

  if (members.length === 0) return null;

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900/80 sm:px-6"
        aria-expanded={open}
      >
        <span>
          {members.length} {members.length === 1 ? "member" : "members"}
        </span>
        <span className="text-zinc-400">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto px-4 pb-3 sm:px-6">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {member.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  friendDisplayName(member).slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {friendDisplayName(member)}
                  {member.isSelf ? (
                    <span className="ml-1.5 font-normal text-zinc-500">(you)</span>
                  ) : null}
                </p>
                {member.username ? (
                  <p className="truncate text-xs text-zinc-500">@{member.username}</p>
                ) : null}
              </div>
              {member.role === "admin" ? (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  Admin
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
