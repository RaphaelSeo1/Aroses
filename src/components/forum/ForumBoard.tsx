"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ForumVoteButton } from "@/components/forum/ForumVoteButton";
import { forumTimeAgo } from "@/lib/forum/relative-time";
import {
  FORUM_CATEGORIES,
  FORUM_CATEGORY_BADGE,
  FORUM_CATEGORY_LABELS,
  type ForumCategory,
  type ForumPost,
} from "@/types/forum";

type Sort = "new" | "top";
type Filter = "all" | ForumCategory;

export function ForumBoard({
  initialPosts,
  votedPostIds,
  currentUserId,
}: {
  initialPosts: ForumPost[];
  votedPostIds: string[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const isAuthed = Boolean(currentUserId);
  const voted = useMemo(() => new Set(votedPostIds), [votedPostIds]);

  const [sort, setSort] = useState<Sort>("top");
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);

  const visible = useMemo(() => {
    const list = initialPosts.filter(
      (p) => filter === "all" || p.category === filter
    );
    const sorted = [...list].sort((a, b) => {
      if (sort === "top" && b.vote_count !== a.vote_count) {
        return b.vote_count - a.vote_count;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return sorted;
  }, [initialPosts, filter, sort]);

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterPill>
          {FORUM_CATEGORIES.map((c) => (
            <FilterPill
              key={c.id}
              active={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.label}
            </FilterPill>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-950">
            <SortTab active={sort === "top"} onClick={() => setSort("top")}>
              Top
            </SortTab>
            <SortTab active={sort === "new"} onClick={() => setSort("new")}>
              New
            </SortTab>
          </div>
          {isAuthed ? (
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover"
            >
              <span aria-hidden className="text-base leading-none">
                +
              </span>
              New post
            </button>
          ) : (
            <Link
              href={`/login?redirect=${encodeURIComponent("/forum")}`}
              className="inline-flex items-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover"
            >
              Log in to post
            </Link>
          )}
        </div>
      </div>

      {composing && isAuthed ? (
        <NewPostForm
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            router.refresh();
          }}
        />
      ) : null}

      {visible.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center dark:border-zinc-800 dark:bg-zinc-950/90">
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            No posts yet
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Be the first to request a course or share feedback.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((p) => (
            <li key={p.id}>
              <div className="flex items-stretch gap-3 rounded-2xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm transition hover:border-brand/25 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/90 dark:hover:border-brand-soft/25">
                <ForumVoteButton
                  postId={p.id}
                  initialCount={p.vote_count}
                  initialVoted={voted.has(p.id)}
                  isAuthenticated={isAuthed}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${FORUM_CATEGORY_BADGE[p.category]}`}
                    >
                      {FORUM_CATEGORY_LABELS[p.category]}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-500">
                      {p.author_name} · {forumTimeAgo(p.created_at)}
                    </span>
                  </div>
                  <Link
                    href={`/forum/${p.id}`}
                    className="mt-1.5 block text-base font-semibold leading-snug text-zinc-900 hover:text-brand dark:text-zinc-50 dark:hover:text-brand-soft"
                  >
                    {p.title}
                  </Link>
                  {p.body ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {p.body}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-500">
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {p.comment_count}{" "}
                    {p.comment_count === 1 ? "comment" : "comments"}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-brand text-white shadow-sm"
          : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:text-brand dark:bg-zinc-950 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:text-brand-soft"
      }`}
    >
      {children}
    </button>
  );
}

function SortTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 transition ${
        active
          ? "bg-brand/10 text-brand dark:bg-brand-soft/15 dark:text-brand-soft"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function NewPostForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<ForumCategory>("course_request");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (title.trim().length < 3) {
      setError("Give your post a title (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, title, body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not create post.");
      }
      setTitle("");
      setBody("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create post.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-wrap gap-1.5">
        {FORUM_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              category === c.id
                ? "bg-brand text-white"
                : "bg-zinc-100 text-zinc-600 hover:text-brand dark:bg-white/10 dark:text-zinc-300"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={140}
        placeholder="Title — e.g. “Organic Chemistry crash course”"
        className="mt-4 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={8000}
        placeholder="Add details (optional) — what you’d like, why it’d help, links…"
        className="mt-3 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
