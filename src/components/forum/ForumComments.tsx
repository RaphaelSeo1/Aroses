"use client";

import Link from "next/link";
import { useState } from "react";
import { forumTimeAgo } from "@/lib/forum/relative-time";
import type { ForumComment } from "@/types/forum";

export function ForumComments({
  postId,
  initialComments,
  currentUserId,
}: {
  postId: string;
  initialComments: ForumComment[];
  currentUserId: string | null;
}) {
  const isAuthed = Boolean(currentUserId);
  const [comments, setComments] = useState<ForumComment[]>(initialComments);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || body.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/forum/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not post comment.");
      }
      const data = (await res.json()) as { comment: ForumComment };
      setComments((prev) => [...prev, data.comment]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    const prev = comments;
    setComments((c) => c.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/forum/comments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setComments(prev);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {comments.length} {comments.length === 1 ? "reply" : "replies"}
      </h2>

      {isAuthed ? (
        <form onSubmit={submit} className="mt-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Add a reply…"
            className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {error ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting || body.trim().length === 0}
              className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-60"
            >
              {submitting ? "Posting…" : "Reply"}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <Link
            href={`/login?redirect=${encodeURIComponent(`/forum/${postId}`)}`}
            className="font-semibold text-brand hover:underline dark:text-brand-soft"
          >
            Log in
          </Link>{" "}
          to join the conversation.
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {comments.map((c) => (
          <li
            key={c.id}
            className="rounded-2xl border border-zinc-200/90 bg-white/95 p-4 dark:border-zinc-800 dark:bg-zinc-950/90"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {c.author_name}
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-500">
                  {forumTimeAgo(c.created_at)}
                </span>
              </p>
              {currentUserId === c.user_id ? (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="text-xs font-medium text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  Delete
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {c.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
