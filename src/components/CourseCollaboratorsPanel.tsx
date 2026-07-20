"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/AppDialogs";
import type { CollaboratorListItem, CollaboratorRole } from "@/lib/collaboration/types";

type Props = {
  courseId: string;
  canManage: boolean;
  viewerRole: CollaboratorRole | null;
  accent?: "brand" | "indigo";
};

function displayLabel(c: CollaboratorListItem): string {
  if (c.displayName?.trim()) return c.displayName.trim();
  if (c.username?.trim()) return `@${c.username.trim()}`;
  if (c.invitedEmail) return c.invitedEmail;
  return "Collaborator";
}

export function CourseCollaboratorsPanel({
  courseId,
  canManage,
  viewerRole,
  accent = "brand",
}: Props) {
  const router = useRouter();
  const [collaborators, setCollaborators] = useState<CollaboratorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteMode, setInviteMode] = useState<"email" | "friends">("email");
  const [friends, setFriends] = useState<{ id: string; userId: string; label: string }[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const primaryColor =
    accent === "indigo"
      ? "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500"
      : "bg-brand hover:bg-brand-hover dark:bg-brand";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/courses/${courseId}/collaborators`);
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok) setCollaborators(body.collaborators ?? []);
          else setError(typeof body.error === "string" ? body.error : "Could not load people.");
        }
      } catch {
        if (!cancelled) setError("Network error.");
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  useEffect(() => {
    if (!canManage || inviteMode !== "friends") return;
    let cancelled = false;
    async function loadFriends() {
      setFriendsLoading(true);
      try {
        const res = await fetch("/api/friends");
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          const list = (body.friends ?? []) as Array<{
            friend: { id: string; displayName: string | null; username: string | null };
          }>;
          setFriends(
            list.map((f) => ({
              id: f.friend.id,
              userId: f.friend.id,
              label: f.friend.displayName ?? (f.friend.username ? `@${f.friend.username}` : "Friend"),
            }))
          );
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setFriendsLoading(false);
    }
    void loadFriends();
    return () => {
      cancelled = true;
    };
  }, [canManage, inviteMode]);

  async function inviteFriend() {
    if (!selectedFriendId) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedFriendId, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not invite friend.");
      } else if (body.collaborator) {
        setCollaborators((prev) => {
          const without = prev.filter((c) => c.id !== body.collaborator.id);
          return [...without, body.collaborator as CollaboratorListItem];
        });
        setSelectedFriendId("");
        router.refresh();
      }
    } catch {
      setError("Network error.");
    }
    setInviting(false);
  }

  async function messageCollaborator(userId: string) {
    setBusyId(userId);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "direct", userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.conversationId) {
        router.push(
          `/dashboard/social?tab=messages&conversation=${encodeURIComponent(body.conversationId)}`
        );
      } else {
        setError(typeof body.error === "string" ? body.error : "Could not open message.");
      }
    } catch {
      setError("Network error.");
    }
    setBusyId(null);
  }

  async function invite() {
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not invite.");
        setInviting(false);
        return;
      }
      if (body.collaborator) {
        setCollaborators((prev) => {
          const without = prev.filter((c) => c.id !== body.collaborator.id);
          return [...without, body.collaborator as CollaboratorListItem];
        });
      }
      setEmail("");
      router.refresh();
    } catch {
      setError("Network error.");
    }
    setInviting(false);
  }

  async function updateRole(collaboratorId: string, nextRole: "editor" | "viewer") {
    setBusyId(collaboratorId);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/collaborators/${collaboratorId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not update role.");
      } else if (body.collaborator) {
        setCollaborators((prev) =>
          prev.map((c) => (c.id === collaboratorId ? body.collaborator : c))
        );
      }
    } catch {
      setError("Network error.");
    }
    setBusyId(null);
  }

  async function removeCollaborator(collaboratorId: string, label: string) {
    const ok = await confirmDialog({
      title: "Remove collaborator?",
      body: `${label} will lose access to this course. Their study progress is kept.`,
      tone: "danger",
      confirmLabel: "Remove",
    });
    if (!ok) return;

    setBusyId(collaboratorId);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/collaborators/${collaboratorId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not remove.");
      } else {
        setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
        router.refresh();
      }
    } catch {
      setError("Network error.");
    }
    setBusyId(null);
  }

  async function transferOwnership(collaboratorId: string, label: string) {
    const ok = await confirmDialog({
      title: "Transfer ownership?",
      body: `${label} will become the owner. You will become an editor.`,
      tone: "danger",
      confirmLabel: "Transfer",
    });
    if (!ok) return;

    setBusyId(collaboratorId);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/collaborators/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collaboratorId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not transfer.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error.");
    }
    setBusyId(null);
  }

  return (
    <div>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Add people</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Invite collaborators to share this course. Everyone keeps their own study progress.
        {canManage ? null : (
          <>
            {" "}
            You are signed in as <span className="font-medium">{viewerRole ?? "member"}</span>.
          </>
        )}
      </p>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <>
          <div className="mt-3 flex gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setInviteMode("email")}
              className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold ${
                inviteMode === "email"
                  ? "bg-white shadow-sm dark:bg-zinc-800"
                  : "text-zinc-500"
              }`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setInviteMode("friends")}
              className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold ${
                inviteMode === "friends"
                  ? "bg-white shadow-sm dark:bg-zinc-800"
                  : "text-zinc-500"
              }`}
            >
              Friends
            </button>
          </div>
          {inviteMode === "email" ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                type="button"
                disabled={inviting || email.trim().length < 3}
                onClick={() => void invite()}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${primaryColor}`}
              >
                {inviting ? "Inviting…" : "Invite"}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                value={selectedFriendId}
                onChange={(e) => setSelectedFriendId(e.target.value)}
                disabled={friendsLoading}
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <option value="">
                  {friendsLoading ? "Loading friends…" : "Choose a friend"}
                </option>
                {friends.map((f) => (
                  <option key={f.id} value={f.userId}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                type="button"
                disabled={inviting || !selectedFriendId}
                onClick={() => void inviteFriend()}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${primaryColor}`}
              >
                {inviting ? "Inviting…" : "Invite"}
              </button>
            </div>
          )}
          {inviteMode === "friends" && !friendsLoading && friends.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              No friends yet — add friends from the{" "}
              <a href="/dashboard/social?tab=friends" className="font-medium text-brand hover:underline">
                Friends page
              </a>
              .
            </p>
          ) : null}
        </>
      ) : null}

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="py-3 text-center text-xs text-zinc-400">Loading…</p>
        ) : collaborators.length === 0 ? (
          <p className="py-2 text-center text-xs text-zinc-400">No collaborators yet.</p>
        ) : (
          collaborators.map((c) => {
            const label = displayLabel(c);
            const isOwner = c.role === "owner";
            const isPending = c.status === "pending";
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {label}
                  </p>
                  {c.invitedEmail && c.displayName ? (
                    <p className="truncate text-[11px] text-zinc-500">{c.invitedEmail}</p>
                  ) : null}
                </div>
                {isPending ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    Pending
                  </span>
                ) : null}
                {canManage && !isOwner && !isPending ? (
                  <select
                    value={c.role === "editor" ? "editor" : "viewer"}
                    disabled={busyId === c.id}
                    onChange={(e) =>
                      void updateRole(c.id, e.target.value as "editor" | "viewer")
                    }
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                ) : (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {c.role}
                  </span>
                )}
                {c.userId && c.status === "accepted" && !isOwner ? (
                  <button
                    type="button"
                    disabled={busyId === c.userId}
                    onClick={() => void messageCollaborator(c.userId!)}
                    className="rounded-md px-2 py-1 text-[10px] font-medium text-brand hover:bg-brand/10 dark:text-brand-soft"
                  >
                    Message
                  </button>
                ) : null}
                {canManage && !isOwner ? (
                  <div className="flex items-center gap-1">
                    {!isPending && c.status === "accepted" ? (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void transferOwnership(c.id, label)}
                        className="rounded-md px-2 py-1 text-[10px] font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Make owner
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => void removeCollaborator(c.id, label)}
                      className="rounded-md px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
