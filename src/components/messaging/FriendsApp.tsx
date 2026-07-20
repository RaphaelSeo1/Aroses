"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { friendDisplayName } from "@/lib/messaging/display-name";
import { socialMessagesHref } from "@/lib/messaging/social-url";
import type { FriendshipListItem } from "@/lib/messaging/types";
import { useT } from "@/lib/i18n/LocaleProvider";

async function openDirectMessage(userId: string): Promise<{ conversationId: string | null; error: string | null }> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "direct", userId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      conversationId: null,
      error: typeof body.error === "string" ? body.error : "Could not open conversation.",
    };
  }
  return {
    conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    error: null,
  };
}

function FriendRow({
  item,
  onMessage,
  onRemove,
  busy,
  messageLabel,
  removeLabel,
}: {
  item: FriendshipListItem;
  onMessage?: () => void;
  onRemove?: () => void;
  busy?: boolean;
  messageLabel: string;
  removeLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {friendDisplayName(item.friend).slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">
          {friendDisplayName(item.friend)}
        </p>
        {item.friend.username ? (
          <p className="text-xs text-zinc-500">@{item.friend.username}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {onMessage ? (
          <button
            type="button"
            disabled={busy}
            onClick={onMessage}
            className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {messageLabel}
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            {removeLabel}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function FriendsApp({
  onOpenConversation,
  embedded = false,
}: {
  onOpenConversation?: (conversationId: string) => void;
  embedded?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [friends, setFriends] = useState<FriendshipListItem[]>([]);
  const [incoming, setIncoming] = useState<FriendshipListItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendshipListItem[]>([]);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupCourseId, setGroupCourseId] = useState("");
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { id: string; username: string | null; displayName: string | null }[]
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/friends");
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setFriends(body.friends ?? []);
        setIncoming(body.incoming ?? []);
        setOutgoing(body.outgoing ?? []);
      } else {
        setError(typeof body.error === "string" ? body.error : t.messages.couldNotLoadFriends);
      }
    } catch {
      setError(t.messages.networkError);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const q = username.trim().replace(/^@/, "");
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/friends/search?u=${encodeURIComponent(q)}`);
          const body = await res.json().catch(() => ({}));
          if (res.ok) {
            setSuggestions(body.suggestions ?? []);
          }
        } catch {
          setSuggestions([]);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [username]);

  async function sendRequest(e: React.FormEvent, pick?: { username?: string; userId?: string }) {
    e.preventDefault();
    setError(null);
    setBusyId("add");
    const target = (pick?.username ?? username).trim().replace(/^@/, "");
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: target,
          userId: pick?.userId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.suggestions) && body.suggestions.length > 0) {
          setSuggestions(body.suggestions);
        }
        setError(typeof body.error === "string" ? body.error : t.messages.couldNotSendRequest);
      } else {
        setUsername("");
        setSuggestions([]);
        await load();
      }
    } catch {
      setError(t.messages.networkError);
    }
    setBusyId(null);
  }

  async function respond(id: string, action: "accept" | "decline") {
    setBusyId(id);
    try {
      await fetch(`/api/friends/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } catch {
      setError(t.messages.networkError);
    }
    setBusyId(null);
  }

  async function removeFriend(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/friends/${id}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Network error.");
    }
    setBusyId(null);
  }

  async function messageFriend(userId: string) {
    setBusyId(userId);
    setError(null);
    const { conversationId, error: openError } = await openDirectMessage(userId);
    setBusyId(null);
    if (conversationId) {
      if (onOpenConversation) onOpenConversation(conversationId);
      else router.push(socialMessagesHref(conversationId));
    } else {
      setError(openError ?? t.messages.couldNotOpenConversation);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setCreatingGroup(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "group",
          title: groupTitle,
          memberIds: [...selectedFriendIds],
          courseId: groupCourseId.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create group.");
      } else if (body.conversationId) {
        if (onOpenConversation) onOpenConversation(body.conversationId);
        else router.push(socialMessagesHref(body.conversationId));
      }
    } catch {
      setError("Network error.");
    }
    setCreatingGroup(false);
  }

  return (
    <div className="space-y-10">
      <section className="rounded-3xl border border-zinc-200/90 bg-white/95 p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950/95 sm:p-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add a friend</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Search by @username or display name. Pick a match from the list when it appears.
        </p>
        <form onSubmit={(e) => void sendRequest(e)} className="relative mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.replace(/^@/, ""));
                setError(null);
              }}
              placeholder="username"
              autoComplete="off"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            />
            {suggestions.length > 0 ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const pick = s.username ?? s.displayName ?? "";
                        if (pick) setUsername(pick);
                        setSuggestions([]);
                        void sendRequest(
                          { preventDefault: () => {} } as React.FormEvent,
                          { username: s.username ?? undefined, userId: s.id }
                        );
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span className="font-medium">
                        {s.username ? `@${s.username}` : s.displayName ?? "User"}
                      </span>
                      {s.displayName && s.username ? (
                        <span className="truncate text-xs text-zinc-500">{s.displayName}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={busyId === "add" || username.trim().length < 2}
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busyId === "add" ? "Sending…" : "Send request"}
          </button>
        </form>
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </section>

      {incoming.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Requests</h2>
          <ul className="mt-4 space-y-2">
            {incoming.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 dark:border-brand/30 dark:bg-brand/10"
              >
                <div>
                  <p className="font-medium">{friendDisplayName(item.friend)}</p>
                  {item.friend.username ? (
                    <p className="text-xs text-zinc-500">@{item.friend.username}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void respond(item.id, "decline")}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
                  >
                    {t.messages.decline}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void respond(item.id, "accept")}
                    className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    {t.messages.accept}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Your friends</h2>
          {friends.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowGroupForm((v) => !v)}
              className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
            >
              {showGroupForm ? "Cancel group" : "New group chat"}
            </button>
          ) : null}
        </div>

        {showGroupForm && friends.length > 0 ? (
          <form
            onSubmit={(e) => void createGroup(e)}
            className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Group name (e.g. Bio study group)"
              className="mb-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <input
              value={groupCourseId}
              onChange={(e) => setGroupCourseId(e.target.value)}
              placeholder="Optional course ID to link this group"
              className="mb-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="mb-2 text-xs text-zinc-500">Select friends to include:</p>
            <div className="flex flex-wrap gap-2">
              {friends.map((f) => {
                const selected = selectedFriendIds.has(f.friend.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setSelectedFriendIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.friend.id)) next.delete(f.friend.id);
                        else next.add(f.friend.id);
                        return next;
                      });
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      selected
                        ? "bg-brand text-white"
                        : "border border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    {friendDisplayName(f.friend)}
                  </button>
                );
              })}
            </div>
            <button
              type="submit"
              disabled={creatingGroup || groupTitle.trim().length < 2 || selectedFriendIds.size === 0}
              className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {creatingGroup ? "Creating…" : "Create group"}
            </button>
          </form>
        ) : null}

        {loading ? (
          <p className="mt-4 text-sm text-zinc-400">Loading…</p>
        ) : friends.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No friends yet — send a request above.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {friends.map((item) => (
              <FriendRow
                key={item.id}
                item={item}
                busy={busyId === item.id || busyId === item.friend.id}
                onMessage={() => void messageFriend(item.friend.id)}
                onRemove={() => void removeFriend(item.id)}
                messageLabel={t.messages.message}
                removeLabel={t.messages.remove}
              />
            ))}
          </ul>
        )}

        {outgoing.length > 0 ? (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pending sent</p>
            <ul className="mt-2 space-y-2">
              {outgoing.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <div>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">
                      {friendDisplayName(item.friend)}
                    </p>
                    {item.friend.username ? (
                      <p className="text-xs text-zinc-500">@{item.friend.username}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-zinc-500">
                    <span className="text-xs">Waiting</span>
                    <button
                      type="button"
                      className="text-xs font-medium text-red-600 hover:underline"
                      onClick={() => void removeFriend(item.id)}
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {!embedded ? (
        <p className="text-center text-sm text-zinc-500">
          Open your{" "}
          <Link href={socialMessagesHref()} className="font-medium text-brand hover:underline">
            inbox
          </Link>{" "}
          to see conversations.
        </p>
      ) : null}
    </div>
  );
}
