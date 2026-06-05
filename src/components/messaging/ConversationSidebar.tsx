"use client";

import Link from "next/link";
import { friendDisplayName } from "@/lib/messaging/display-name";
import type { ConversationMember } from "@/lib/messaging/types";

type Props = {
  title: string;
  isGroup: boolean;
  members: ConversationMember[];
  courseId?: string | null;
  courseTitle?: string | null;
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
  title,
  isGroup,
  members,
  courseId,
  courseTitle,
}: Props) {
  if (!isGroup && members.length <= 1) return null;

  const aboutText = isGroup
    ? courseTitle
      ? `Study group for ${courseTitle}.`
      : `Group chat with ${members.length} members.`
    : null;

  return (
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
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          {isGroup ? `Members — ${members.length}` : "Chat"}
        </h2>
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
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/80 dark:hover:bg-zinc-800/60"
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
