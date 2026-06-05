"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type PendingInvite = {
  id: string;
  courseId: string;
  courseTitle: string;
  role: string;
  invitedEmail: string | null;
};

export function PendingCollaboratorInvites() {
  const router = useRouter();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/collaborators/pending");
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setInvites(body.invites ?? []);
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

  if (loading || invites.length === 0) return null;

  async function respond(id: string, action: "accept" | "decline") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/collaborators/${id}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== id));
        router.refresh();
      }
    } catch {
      /* ignore */
    }
    setBusyId(null);
  }

  return (
    <section className="mb-6 rounded-2xl border border-brand/20 bg-brand/5 p-4 dark:border-brand/30 dark:bg-brand/10">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Course invites
      </p>
      <ul className="mt-3 space-y-2">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-white/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/80"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {invite.courseTitle}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Invited as {invite.role}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyId === invite.id}
                onClick={() => void respond(invite.id, "decline")}
                className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busyId === invite.id}
                onClick={() => void respond(invite.id, "accept")}
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
              >
                Accept
              </button>
              <Link
                href={`/dashboard/courses/${invite.courseId}`}
                className="text-xs font-medium text-brand hover:underline dark:text-brand-soft"
              >
                View
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
