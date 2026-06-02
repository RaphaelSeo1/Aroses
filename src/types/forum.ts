export type ForumCategory = "course_request" | "feedback" | "discussion" | "bug";

export type ForumPost = {
  id: string;
  user_id: string;
  author_name: string;
  category: ForumCategory;
  title: string;
  /** Plain-text mirror of `body_rich` (also holds legacy plain-text posts). */
  body: string;
  /** TipTap JSON for the formatted body. Null/absent for legacy plain-text posts. */
  body_rich?: unknown;
  vote_count: number;
  comment_count: number;
  pinned: boolean;
  view_count: number;
  created_at: string;
};

export type ForumComment = {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

export const FORUM_CATEGORIES: {
  id: ForumCategory;
  label: string;
  /** Tailwind classes for the category badge. */
  badge: string;
}[] = [
  {
    id: "course_request",
    label: "Course request",
    badge:
      "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30",
  },
  {
    id: "feedback",
    label: "Feedback",
    badge:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  },
  {
    id: "discussion",
    label: "Discussion",
    badge:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/15",
  },
  {
    id: "bug",
    label: "Bug",
    badge:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  },
];

export const FORUM_CATEGORY_LABELS: Record<ForumCategory, string> =
  Object.fromEntries(FORUM_CATEGORIES.map((c) => [c.id, c.label])) as Record<
    ForumCategory,
    string
  >;

export const FORUM_CATEGORY_BADGE: Record<ForumCategory, string> =
  Object.fromEntries(FORUM_CATEGORIES.map((c) => [c.id, c.badge])) as Record<
    ForumCategory,
    string
  >;

export function isForumCategory(value: unknown): value is ForumCategory {
  return (
    value === "course_request" ||
    value === "feedback" ||
    value === "discussion" ||
    value === "bug"
  );
}
