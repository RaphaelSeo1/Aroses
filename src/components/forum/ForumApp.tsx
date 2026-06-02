"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ForumComments } from "@/components/forum/ForumComments";
import { ForumVoteButton } from "@/components/forum/ForumVoteButton";
import { forumTimeAgo } from "@/lib/forum/relative-time";
import {
  FORUM_CATEGORIES,
  FORUM_CATEGORY_BADGE,
  FORUM_CATEGORY_LABELS,
  type ForumCategory,
  type ForumComment,
  type ForumPost,
} from "@/types/forum";

type Sort = "new" | "top";
type Filter = "all" | ForumCategory;

type DetailState = {
  status: "loading" | "ready" | "error";
  comments: ForumComment[];
  voted: boolean;
};

const loginHref = (next: string) =>
  `/login?redirect=${encodeURIComponent(next)}`;

export function ForumApp({
  initialPosts,
  votedPostIds,
  currentUserId,
  isAdmin = false,
}: {
  initialPosts: ForumPost[];
  votedPostIds: string[];
  currentUserId: string | null;
  isAdmin?: boolean;
}) {
  const isAuthed = Boolean(currentUserId);
  const votedSet = useMemo(() => new Set(votedPostIds), [votedPostIds]);

  const [posts, setPosts] = useState<ForumPost[]>(initialPosts);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const didAutoSelect = useRef(false);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: posts.length };
    for (const c of FORUM_CATEGORIES) map[c.id] = 0;
    for (const p of posts) map[p.category] = (map[p.category] ?? 0) + 1;
    return map;
  }, [posts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = posts.filter((p) => {
      if (filter !== "all" && p.category !== filter) return false;
      if (q && !`${p.title} ${p.body}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "top" && b.vote_count !== a.vote_count) {
        return b.vote_count - a.vote_count;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [posts, filter, query, sort]);

  // On wide screens, open the first thread so the detail pane isn't empty.
  useEffect(() => {
    if (didAutoSelect.current) return;
    didAutoSelect.current = true;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches &&
      visible.length > 0
    ) {
      void openThread(visible[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openThread(id: string) {
    setComposing(false);
    setSelectedId(id);
    if (details[id]?.status === "ready") return;
    setDetails((d) => ({
      ...d,
      [id]: { status: "loading", comments: [], voted: votedSet.has(id) },
    }));
    try {
      const res = await fetch(`/api/forum/posts/${id}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as {
        post: ForumPost;
        comments: ForumComment[];
        voted: boolean;
      };
      setPosts((prev) => prev.map((p) => (p.id === id ? data.post : p)));
      setDetails((d) => ({
        ...d,
        [id]: { status: "ready", comments: data.comments, voted: data.voted },
      }));
    } catch {
      setDetails((d) => ({
        ...d,
        [id]: { status: "error", comments: [], voted: votedSet.has(id) },
      }));
    }
  }

  function updateCount(id: string, patch: Partial<ForumPost>) {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function handleCreated(post: ForumPost) {
    setPosts((prev) => [post, ...prev]);
    setComposing(false);
    setDetails((d) => ({
      ...d,
      [post.id]: { status: "ready", comments: [], voted: false },
    }));
    setSelectedId(post.id);
  }

  async function deletePost(id: string) {
    const prev = posts;
    setPosts((p) => p.filter((x) => x.id !== id));
    setSelectedId(null);
    try {
      const res = await fetch(`/api/forum/posts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setPosts(prev);
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    const prev = posts;
    updateCount(id, { pinned });
    try {
      const res = await fetch(`/api/forum/posts/${id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) throw new Error("pin failed");
    } catch {
      setPosts(prev);
    }
  }

  const selected = selectedId ? posts.find((p) => p.id === selectedId) : null;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-white dark:bg-zinc-950 sm:h-[calc(100dvh-4rem)]">
      {/* ---------- Sidebar (lg+) ---------- */}
      <aside className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-200 bg-zinc-50/60 p-3 lg:flex dark:border-zinc-800 dark:bg-zinc-900/40">
        <NewThreadButton
          isAuthed={isAuthed}
          onClick={() => {
            setComposing(true);
            setSelectedId(null);
          }}
        />
        <div>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Categories
          </p>
          <nav className="mt-1 space-y-0.5">
            <CategoryButton
              active={filter === "all"}
              label="All threads"
              count={counts.all}
              onClick={() => setFilter("all")}
            />
            {FORUM_CATEGORIES.map((c) => (
              <CategoryButton
                key={c.id}
                active={filter === c.id}
                label={c.label}
                count={counts[c.id] ?? 0}
                onClick={() => setFilter(c.id)}
              />
            ))}
          </nav>
        </div>
      </aside>

      {/* ---------- Thread list ---------- */}
      <div
        className={`${
          selectedId || composing ? "hidden lg:flex" : "flex"
        } w-full shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 lg:w-80`}
      >
        <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search threads"
              className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          {/* Mobile: new thread + category chips */}
          <div className="flex flex-wrap items-center gap-1.5 lg:hidden">
            <NewThreadButton
              compact
              isAuthed={isAuthed}
              onClick={() => {
                setComposing(true);
                setSelectedId(null);
              }}
            />
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </Chip>
            {FORUM_CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                active={filter === c.id}
                onClick={() => setFilter(c.id)}
              >
                {c.label}
              </Chip>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
              {visible.length} thread{visible.length === 1 ? "" : "s"}
            </span>
            <div className="inline-flex rounded-full border border-zinc-200 p-0.5 text-[11px] font-semibold dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setSort("new")}
                className={`rounded-full px-2.5 py-1 transition ${
                  sort === "new"
                    ? "bg-brand/10 text-brand dark:bg-brand-soft/15 dark:text-brand-soft"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                New
              </button>
              <button
                type="button"
                onClick={() => setSort("top")}
                className={`rounded-full px-2.5 py-1 transition ${
                  sort === "top"
                    ? "bg-brand/10 text-brand dark:bg-brand-soft/15 dark:text-brand-soft"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                Top
              </button>
            </div>
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No threads here yet.
            </li>
          ) : (
            visible.map((p) => (
              <ThreadRow
                key={p.id}
                post={p}
                active={p.id === selectedId}
                onClick={() => openThread(p.id)}
              />
            ))
          )}
        </ul>
      </div>

      {/* ---------- Detail / composer ---------- */}
      <div
        className={`${
          selectedId || composing ? "flex" : "hidden lg:flex"
        } min-w-0 flex-1 flex-col overflow-y-auto`}
      >
        {composing ? (
          <Composer
            onCancel={() => setComposing(false)}
            onCreated={handleCreated}
          />
        ) : selected ? (
          <ThreadDetail
            key={selected.id}
            post={selected}
            detail={details[selected.id]}
            currentUserId={currentUserId}
            isAuthed={isAuthed}
            isAdmin={isAdmin}
            initialVoted={details[selected.id]?.voted ?? votedSet.has(selected.id)}
            onBack={() => setSelectedId(null)}
            onVoteChange={(count) => updateCount(selected.id, { vote_count: count })}
            onCommentCount={(count) =>
              updateCount(selected.id, { comment_count: count })
            }
            onTogglePin={() => togglePin(selected.id, !selected.pinned)}
            onDelete={() => deletePost(selected.id)}
          />
        ) : (
          <EmptyDetail />
        )}
      </div>
    </div>
  );
}

// ---------- pieces ----------

function NewThreadButton({
  isAuthed,
  onClick,
  compact,
}: {
  isAuthed: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const cls = compact
    ? "inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover"
    : "inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover";
  if (!isAuthed) {
    return (
      <Link href={loginHref("/forum")} className={cls}>
        <span aria-hidden className="text-base leading-none">
          +
        </span>
        New thread
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <span aria-hidden className="text-base leading-none">
        +
      </span>
      New thread
    </button>
  );
}

function CategoryButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition ${
        active
          ? "bg-brand/10 font-semibold text-brand dark:bg-brand-soft/15 dark:text-brand-soft"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="ml-2 shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
        {count}
      </span>
    </button>
  );
}

function Chip({
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
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
        active
          ? "bg-brand text-white"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function ThreadRow({
  post,
  active,
  onClick,
}: {
  post: ForumPost;
  active: boolean;
  onClick: () => void;
}) {
  const answered = post.comment_count > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3 text-left transition dark:border-zinc-900 ${
          active
            ? "bg-brand/[0.06] dark:bg-brand-soft/[0.08]"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
        }`}
      >
        <span
          className={`mt-0.5 shrink-0 ${
            answered
              ? "text-emerald-500"
              : "text-zinc-300 dark:text-zinc-600"
          }`}
          aria-hidden
        >
          {answered ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {post.pinned ? (
              <svg
                className="h-3.5 w-3.5 shrink-0 text-brand dark:text-brand-soft"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-label="Pinned"
              >
                <path d="M16 3a1 1 0 0 1 .7 1.7L15 6.4V11l2.6 2.6a1 1 0 0 1-.7 1.7H13v5a1 1 0 0 1-2 0v-5H7.1a1 1 0 0 1-.7-1.7L9 11V6.4L7.3 4.7A1 1 0 0 1 8 3z" />
              </svg>
            ) : null}
            <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {post.title}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-500">
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold ring-1 ring-inset ${FORUM_CATEGORY_BADGE[post.category]}`}
            >
              {FORUM_CATEGORY_LABELS[post.category]}
            </span>
            <span className="truncate">
              {post.author_name} · {forumTimeAgo(post.created_at)}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m18 15-6-6-6 6" />
            </svg>
            {post.vote_count}
          </span>
          <span className="inline-flex items-center gap-1">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {post.comment_count}
          </span>
        </span>
      </button>
    </li>
  );
}

function ThreadDetail({
  post,
  detail,
  currentUserId,
  isAuthed,
  isAdmin,
  initialVoted,
  onBack,
  onVoteChange,
  onCommentCount,
  onTogglePin,
  onDelete,
}: {
  post: ForumPost;
  detail: DetailState | undefined;
  currentUserId: string | null;
  isAuthed: boolean;
  isAdmin: boolean;
  initialVoted: boolean;
  onBack: () => void;
  onVoteChange: (count: number) => void;
  onCommentCount: (count: number) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-8 sm:py-7">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-brand lg:hidden dark:text-zinc-400 dark:hover:text-brand-soft"
        >
          <span aria-hidden>←</span> Back
        </button>
        <Link
          href={`/forum/${post.id}`}
          className="ml-auto text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          title="Open full page (shareable link)"
        >
          Open full page ↗
        </Link>
      </div>

      <div className="mt-3 flex items-start gap-4">
        <ForumVoteButton
          postId={post.id}
          initialCount={post.vote_count}
          initialVoted={initialVoted}
          isAuthenticated={isAuthed}
          onChange={({ count }) => onVoteChange(count)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${FORUM_CATEGORY_BADGE[post.category]}`}
            >
              {FORUM_CATEGORY_LABELS[post.category]}
            </span>
            {post.pinned ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-brand-soft/15 dark:text-brand-soft">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M16 3a1 1 0 0 1 .7 1.7L15 6.4V11l2.6 2.6a1 1 0 0 1-.7 1.7H13v5a1 1 0 0 1-2 0v-5H7.1a1 1 0 0 1-.7-1.7L9 11V6.4L7.3 4.7A1 1 0 0 1 8 3z" />
                </svg>
                Pinned
              </span>
            ) : null}
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {post.author_name} · {forumTimeAgo(post.created_at)}
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs">
              <span
                className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500"
                title={`${post.view_count} view${post.view_count === 1 ? "" : "s"}`}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="tabular-nums">{post.view_count}</span>
              </span>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={onTogglePin}
                  className="font-medium text-zinc-500 hover:text-brand dark:text-zinc-400 dark:hover:text-brand-soft"
                >
                  {post.pinned ? "Unpin" : "Pin"}
                </button>
              ) : null}
              {currentUserId === post.user_id ? (
                confirmDelete ? (
                  <span className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onDelete}
                      className="font-semibold text-red-600 hover:underline dark:text-red-400"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="font-medium text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    Delete
                  </button>
                )
              ) : null}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
            {post.title}
          </h1>
          {post.body ? (
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              {post.body}
            </p>
          ) : null}
        </div>
      </div>

      {!detail || detail.status === "loading" ? (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
          Loading replies…
        </p>
      ) : detail.status === "error" ? (
        <p className="mt-8 text-sm text-red-600 dark:text-red-400">
          Could not load replies.
        </p>
      ) : (
        <ForumComments
          postId={post.id}
          initialComments={detail.comments}
          currentUserId={currentUserId}
          onCountChange={onCommentCount}
        />
      )}
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-zinc-100 p-4 dark:bg-zinc-900">
        <svg className="h-7 w-7 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        Select a thread to read it
      </p>
      <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-500">
        Or start a new thread to request a course, share feedback, or ask the
        community something.
      </p>
    </div>
  );
}

function Composer({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (post: ForumPost) => void;
}) {
  const [category, setCategory] = useState<ForumCategory>("course_request");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (title.trim().length < 3) {
      setError("Give your thread a title (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, title, body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not create thread.");
      }
      const data = (await res.json()) as { post: ForumPost };
      onCreated(data.post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create thread.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-8 sm:py-7"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          New thread
        </h1>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
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
        rows={8}
        maxLength={8000}
        placeholder="Add details (optional) — what you’d like, why it’d help, links…"
        className="mt-3 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post thread"}
        </button>
      </div>
    </form>
  );
}
