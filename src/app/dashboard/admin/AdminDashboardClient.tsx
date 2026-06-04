"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { alertDialog, confirmDialog } from "@/components/AppDialogs";
import type { AdminActivityItem, AdminUserRow } from "@/lib/admin-dashboard-data";
import {
  AdminPendingListings,
  type PendingListingRow,
} from "@/components/admin/AdminPendingListings";

/** Bounded vertical scroll for large tables — keeps the admin page compact. */
const TABLE_BODY_SCROLL =
  "max-h-[min(17rem,38vh)] overflow-y-auto overflow-x-auto overscroll-contain [scrollbar-gutter:stable] sm:max-h-[min(21rem,42vh)] lg:max-h-[min(26rem,46vh)]";

const ACTIVITY_SCROLL =
  "max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain sm:max-h-[min(32rem,64vh)] [scrollbar-gutter:stable]";

export type AdminCourseRow = {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  is_public: boolean | null;
};

type Props = {
  courses: AdminCourseRow[];
  pendingListings: PendingListingRow[];
  showMarketplaceListings?: boolean;
  stats: {
    totalCourses: number;
    totalUsers: number;
    publicCourses: number;
    privateCourses: number;
  };
  users: AdminUserRow[];
  usersError: string | null;
  activity: AdminActivityItem[];
  loadError: string | null;
};

function formatWhenCompact(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function IconCourses({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconLock({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  icon,
  iconClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconClass: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-sm shadow-zinc-900/[0.02] dark:border-zinc-700/90 dark:bg-zinc-900/70 dark:shadow-black/20">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <span className={iconClass}>{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function CopyTextButton({
  text,
  label,
}: {
  text: string;
  /** e.g. "Copy email" */
  label: string;
}) {
  const [done, setDone] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex shrink-0 items-center rounded-md border border-zinc-200/90 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
      aria-label={label}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function AdminDashboardClient({
  courses: initialCourses,
  pendingListings,
  showMarketplaceListings = false,
  stats,
  users: initialUsers,
  usersError,
  activity,
  loadError,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fatalConfigError = Boolean(
    loadError && loadError.includes("Service role")
  );

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return initialUsers;
    return initialUsers.filter((u) => {
      const hay = [
        u.email,
        u.id,
        u.displayName ?? "",
        u.username ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [initialUsers, userQuery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialCourses;
    return initialCourses.filter((c) =>
      (c.title || "Untitled").toLowerCase().includes(q)
    );
  }, [initialCourses, query]);

  const onDelete = useCallback(
    async (courseId: string, title: string) => {
      const ok = await confirmDialog({
        title: `Delete “${title || "Untitled"}”?`,
        body: "This removes the course and related data for learners.",
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!ok) return;
      setDeletingId(courseId);
      try {
        const res = await fetch(`/api/courses/${courseId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          await alertDialog({
            title: "Couldn’t delete course",
            body: j.error ?? "Could not delete course.",
            tone: "danger",
          });
          return;
        }
        router.refresh();
      } finally {
        setDeletingId(null);
      }
    },
    [router]
  );

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-8">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center rounded-md bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:bg-red-500/15 dark:text-red-400"
          >
            Admin
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[1.65rem]">
          Site operations
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Manage courses, accounts, and a light activity feed. Changes here affect
          the whole platform.
        </p>

        {loadError ? (
          <div
            className="mt-5 rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-3 text-xs leading-relaxed text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
          >
            {loadError}
          </div>
        ) : null}

        {!fatalConfigError ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total courses"
              value={stats.totalCourses}
              icon={<IconCourses />}
              iconClass="text-[#DC2626]/90"
            />
            <MetricCard
              label="Total users"
              value={stats.totalUsers}
              icon={<IconUsers />}
              iconClass="text-zinc-400 dark:text-zinc-500"
            />
            <MetricCard
              label="Public courses"
              value={stats.publicCourses}
              icon={<IconGlobe />}
              iconClass="text-[#DC2626]/80"
            />
            <MetricCard
              label="Private courses"
              value={stats.privateCourses}
              icon={<IconLock />}
              iconClass="text-zinc-400 dark:text-zinc-500"
            />
          </div>
        ) : null}

        {!fatalConfigError && showMarketplaceListings ? (
          <section className="mt-8 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-700/90 dark:bg-zinc-900/70">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Pending marketplace listings
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Review seller attestations and automated quality flags before
              courses go live for sale.
            </p>
            <div className="mt-4">
              <AdminPendingListings listings={pendingListings} />
            </div>
          </section>
        ) : null}

        {!fatalConfigError ? (
          <section className="mt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  User directory
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Auth sign-in email and profile fields — separate from the activity
                  feed below.
                </p>
              </div>
              <label className="block w-full sm:max-w-[14rem]">
                <span className="sr-only">Search users</span>
                <input
                  type="search"
                  placeholder="Search users…"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-red-500/25"
                />
              </label>
            </div>

            {usersError ? (
              <div className="mt-3 rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/25 dark:text-red-100">
                Could not load Auth users: {usersError}
              </div>
            ) : null}

            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-700/90 dark:bg-zinc-900/60 dark:shadow-black/30">
              <div className={TABLE_BODY_SCROLL}>
                <table className="min-w-full border-collapse text-left">
                  <thead className="sticky top-0 z-[1] border-b border-zinc-200 bg-zinc-100/95 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-800/95 dark:shadow-none">
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      <th className="px-3 py-2 font-semibold sm:px-3.5">
                        Email
                      </th>
                      <th className="hidden px-3 py-2 font-semibold lg:table-cell lg:px-3.5">
                        Name
                      </th>
                      <th className="hidden px-3 py-2 font-semibold xl:table-cell xl:px-3.5">
                        Username
                      </th>
                      <th className="hidden px-3 py-2 font-semibold md:table-cell md:px-3.5">
                        User ID
                      </th>
                      <th className="px-3 py-2 font-semibold sm:px-3.5">
                        Joined
                      </th>
                      <th className="hidden px-3 py-2 font-semibold lg:table-cell lg:px-3.5">
                        Last in
                      </th>
                      <th className="hidden px-3 py-2 font-semibold sm:table-cell sm:px-3.5">
                        Email ✓
                      </th>
                      <th className="hidden px-3 py-2 font-semibold xl:table-cell xl:px-3.5">
                        Onboard
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-xs text-zinc-600 dark:text-zinc-300">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400"
                        >
                          {initialUsers.length === 0
                            ? "No Auth users returned."
                            : "No users match your search."}
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u, index) => (
                        <tr
                          key={u.id}
                          className={
                            index % 2 === 0
                              ? "bg-white dark:bg-zinc-950/50"
                              : "bg-zinc-50/60 dark:bg-zinc-900/35"
                          }
                        >
                          <td className="border-t border-zinc-100/90 px-3 py-2 dark:border-zinc-800 sm:px-3.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                                {u.email}
                              </span>
                              {u.email !== "—" ? (
                                <CopyTextButton
                                  text={u.email}
                                  label="Copy email"
                                />
                              ) : null}
                            </div>
                            <div className="mt-1.5 flex flex-col gap-0.5 lg:hidden">
                              {u.displayName ? (
                                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  {u.displayName}
                                </span>
                              ) : null}
                              {u.username ? (
                                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                                  @{u.username}
                                </span>
                              ) : null}
                              <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                                {u.id.slice(0, 12)}…
                              </span>
                              <CopyTextButton text={u.id} label="Copy user ID" />
                            </div>
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300 lg:table-cell lg:px-3.5">
                            {u.displayName?.trim() || "—"}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300 xl:table-cell xl:px-3.5">
                            {u.username ? (
                              <span className="font-mono text-[11px]">
                                @{u.username}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 md:table-cell md:px-3.5 dark:border-zinc-800">
                            <div className="flex max-w-[11rem] items-center gap-1">
                              <span
                                className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
                                title={u.id}
                              >
                                {u.id}
                              </span>
                              <CopyTextButton text={u.id} label="Copy user ID" />
                            </div>
                          </td>
                          <td className="border-t border-zinc-100/90 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 sm:px-3.5">
                            <time dateTime={u.signedUpAt}>
                              {formatWhenCompact(u.signedUpAt)}
                            </time>
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 lg:table-cell lg:px-3.5">
                            {u.lastSignInAt ? (
                              <time dateTime={u.lastSignInAt}>
                                {formatWhenCompact(u.lastSignInAt)}
                              </time>
                            ) : (
                              <span className="text-zinc-400 dark:text-zinc-500">—</span>
                            )}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 sm:table-cell sm:px-3.5 dark:border-zinc-800">
                            {u.emailConfirmedAt ? (
                              <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-600/12 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-500/25">
                                Yes
                              </span>
                            ) : (
                              <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-600/15 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/30">
                                Pending
                              </span>
                            )}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 xl:table-cell xl:px-3.5 dark:border-zinc-800">
                            {u.onboardingCompletedAt ? (
                              <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                Done
                              </span>
                            ) : (
                              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {!fatalConfigError ? (
          <section className="mt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  All courses
                </h2>
                <span className="rounded-md bg-zinc-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {filtered.length}
                  {query.trim() ? ` / ${initialCourses.length}` : ""}
                </span>
              </div>
              <label className="block w-full sm:max-w-[14rem]">
                <span className="sr-only">Search courses</span>
                <input
                  type="search"
                  placeholder="Search courses…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/15 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-red-500/25"
                />
              </label>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-700/90 dark:bg-zinc-900/60 dark:shadow-black/30">
              <div className={TABLE_BODY_SCROLL}>
                <table className="min-w-full border-collapse text-left">
                  <thead className="sticky top-0 z-[1] border-b border-zinc-200 bg-zinc-100/95 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-800/95 dark:shadow-none">
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      <th className="px-3 py-2 font-semibold sm:px-3.5">
                        Course
                      </th>
                      <th className="hidden px-3 py-2 font-semibold md:table-cell md:px-3.5">
                        Owner ID
                      </th>
                      <th className="px-3 py-2 font-semibold sm:px-3.5">
                        Visibility
                      </th>
                      <th className="px-3 py-2 text-right font-semibold sm:px-3.5">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-xs text-zinc-600 dark:text-zinc-300">
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400"
                        >
                          No courses match your search.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((c, index) => {
                        const isPublic = Boolean(c.is_public);
                        return (
                          <tr
                            key={c.id}
                            className={
                              index % 2 === 0
                                ? "bg-white dark:bg-zinc-950/50"
                                : "bg-zinc-50/60 dark:bg-zinc-900/35"
                            }
                          >
                            <td className="border-t border-zinc-100/90 px-3 py-2 dark:border-zinc-800 sm:px-3.5">
                              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                                {c.title?.trim() || "Untitled"}
                              </span>
                              <div className="mt-1 md:hidden">
                                <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                                  {c.user_id.slice(0, 10)}…
                                </span>
                                <CopyTextButton
                                  text={c.user_id}
                                  label="Copy owner ID"
                                />
                              </div>
                            </td>
                            <td className="hidden border-t border-zinc-100/90 px-3 py-2 md:table-cell md:px-3.5 dark:border-zinc-800">
                              <div className="flex max-w-[14rem] items-center gap-1">
                                <span
                                  className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
                                  title={c.user_id}
                                >
                                  {c.user_id}
                                </span>
                                <CopyTextButton
                                  text={c.user_id}
                                  label="Copy owner ID"
                                />
                              </div>
                            </td>
                            <td className="border-t border-zinc-100/90 px-3 py-2 dark:border-zinc-800 sm:px-3.5">
                              {isPublic ? (
                                <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-600/12 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-500/25">
                                  Public
                                </span>
                              ) : (
                                <span className="inline-flex rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-300/50 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600/40">
                                  Private
                                </span>
                              )}
                            </td>
                            <td className="border-t border-zinc-100/90 px-3 py-2 text-right dark:border-zinc-800 sm:px-3.5">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <Link
                                  href={`/dashboard/courses/${c.id}`}
                                  className="inline-flex rounded-md border border-zinc-200/90 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                  View
                                </Link>
                                <button
                                  type="button"
                                  disabled={deletingId === c.id}
                                  onClick={() =>
                                    void onDelete(
                                      c.id,
                                      c.title?.trim() || "Untitled"
                                    )
                                  }
                                  className="inline-flex rounded-md bg-red-600 px-2 py-1 text-[10px] font-semibold text-white transition enabled:hover:bg-red-700 disabled:opacity-50 dark:bg-red-600 dark:enabled:hover:bg-red-500"
                                >
                                  {deletingId === c.id ? "…" : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {!fatalConfigError && activity.length > 0 ? (
          <section className="mt-8 pb-4">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Activity timeline
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Full activity log — logins, logouts, voice-tutor sessions, module
              completions, quiz attempts, course builds, and more. Kept for 30
              days, newest first.
            </p>
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-700/90 dark:bg-zinc-900/60 dark:shadow-black/30">
              <ul
                className={`divide-y divide-zinc-100 dark:divide-zinc-800 ${ACTIVITY_SCROLL}`}
                role="list"
              >
                {activity.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-3.5"
                  >
                    <div>
                      <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                        {a.detail}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {a.title}
                      </p>
                    </div>
                    <time
                      className="shrink-0 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 sm:text-right"
                      dateTime={a.at}
                    >
                      {formatWhenCompact(a.at)}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
