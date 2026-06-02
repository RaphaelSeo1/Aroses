"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Upvote toggle for a forum post. Optimistic; reverts on error. Anonymous
 * visitors are sent to the login page.
 */
export function ForumVoteButton({
  postId,
  initialCount,
  initialVoted,
  isAuthenticated,
  size = "md",
  onChange,
}: {
  postId: string;
  initialCount: number;
  initialVoted: boolean;
  isAuthenticated: boolean;
  size?: "sm" | "md";
  /** Notified with the authoritative count after a successful toggle. */
  onChange?: (next: { voted: boolean; count: number }) => void;
}) {
  const router = useRouter();
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent("/forum")}`);
      return;
    }
    if (busy) return;

    const prevVoted = voted;
    const prevCount = count;
    const nextVoted = !prevVoted;
    setVoted(nextVoted);
    setCount(prevCount + (nextVoted ? 1 : -1));
    setBusy(true);
    try {
      const res = await fetch(`/api/forum/posts/${postId}/vote`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("vote failed");
      const data = (await res.json()) as { voted: boolean; voteCount: number };
      setVoted(data.voted);
      setCount(data.voteCount);
      onChange?.({ voted: data.voted, count: data.voteCount });
    } catch {
      setVoted(prevVoted);
      setCount(prevCount);
    } finally {
      setBusy(false);
    }
  }

  const pad = size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={voted}
      title={voted ? "Remove your upvote" : "Upvote"}
      className={`inline-flex shrink-0 flex-col items-center justify-center rounded-xl border ${pad} font-semibold tabular-nums transition disabled:opacity-60 ${
        voted
          ? "border-brand/40 bg-brand/10 text-brand dark:border-brand-soft/40 dark:bg-brand-soft/10 dark:text-brand-soft"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-brand/30 hover:text-brand dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-brand-soft/30 dark:hover:text-brand-soft"
      }`}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill={voted ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
      <span className={size === "sm" ? "text-xs" : "text-sm"}>{count}</span>
    </button>
  );
}
