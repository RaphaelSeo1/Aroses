"use client";

import { useEffect, useMemo, useState } from "react";
import { friendDisplayName } from "@/lib/messaging/display-name";
import type { FriendshipListItem } from "@/lib/messaging/types";

type Props = {
  conversationId: string;
  memberIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
};

export function AddGroupMembersModal({
  conversationId,
  memberIds,
  onClose,
  onAdded,
}: Props) {
  const [friends, setFriends] = useState<FriendshipListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () => friends.filter((f) => !memberIds.has(f.friend.id)),
    [friends, memberIds]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/friends");
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(body.friends)) {
          setFriends(body.friends);
        }
      } catch {
        if (!cancelled) setError("Could not load friends.");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function addMembers(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not add members.");
      } else {
        onAdded();
        onClose();
      }
    } catch {
      setError("Network error.");
    }
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-members-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-members-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Add members
        </h2>
        <p className="mt-1 text-sm text-zinc-500">Pick friends to add to this group.</p>

        {loading ? (
          <p className="mt-6 text-sm text-zinc-400">Loading friends…</p>
        ) : available.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">
            No friends available to add. Everyone you know is already here, or add friends first.
          </p>
        ) : (
          <form onSubmit={(e) => void addMembers(e)} className="mt-4">
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {available.map((f) => {
                const checked = selected.has(f.friend.id);
                return (
                  <label
                    key={f.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.friend.id)) next.delete(f.friend.id);
                          else next.add(f.friend.id);
                          return next;
                        });
                      }}
                      className="rounded border-zinc-300"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {friendDisplayName(f.friend)}
                      </span>
                      {f.friend.username ? (
                        <span className="block truncate text-xs text-zinc-500">
                          @{f.friend.username}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {error ? (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || selected.size === 0}
                className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {busy ? "Adding…" : `Add${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </button>
            </div>
          </form>
        )}

        {!loading && available.length === 0 ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
