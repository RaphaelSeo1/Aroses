"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ForumDeletePost({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/forum/posts/${postId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      router.push("/forum");
      router.refresh();
    } catch {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="text-sm font-medium text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">Delete this post?</span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="font-semibold text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
      >
        {busy ? "Deleting…" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        className="font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Cancel
      </button>
    </span>
  );
}
