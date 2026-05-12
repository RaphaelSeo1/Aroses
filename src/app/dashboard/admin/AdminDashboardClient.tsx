"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { AdminActivityItem, AdminUserRow } from "@/lib/admin-dashboard-data";

const INK = "#1a0505";
const ACCENT = "#DC2626";

/** Bounded vertical scroll for large tables — keeps the admin page compact. */
const TABLE_BODY_SCROLL =
  "max-h-[min(17rem,38vh)] overflow-y-auto overflow-x-auto overscroll-contain [scrollbar-gutter:stable] sm:max-h-[min(21rem,42vh)] lg:max-h-[min(26rem,46vh)]";

const ACTIVITY_SCROLL =
  "max-h-[min(12rem,32vh)] overflow-y-auto overscroll-contain sm:max-h-[min(15rem,36vh)] [scrollbar-gutter:stable]";

export type AdminCourseRow = {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  is_public: boolean | null;
};

type Props = {
  courses: AdminCourseRow[];
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
    <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-sm shadow-zinc-900/[0.02]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        <span className={iconClass}>{icon}</span>
      </div>
      <p
        className="mt-2 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl"
        style={{ color: INK }}
      >
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
      className="inline-flex shrink-0 items-center rounded-md border border-zinc-200/90 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50"
      style={{ color: INK }}
      aria-label={label}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function AdminDashboardClient({
  courses: initialCourses,
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
      const ok = window.confirm(
        `Delete “${title || "Untitled"}”? This removes the course and related data for learners.`
      );
      if (!ok) return;
      setDeletingId(courseId);
      try {
        const res = await fetch(`/api/courses/${courseId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          window.alert(j.error ?? "Could not delete course.");
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
    <div className="min-h-[calc(100vh-4rem)] bg-zinc-50/50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-8">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${ACCENT}12`, color: ACCENT }}
          >
            Admin
          </span>
        </div>
        <h1
          className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-[1.65rem]"
          style={{ color: INK }}
        >
          Site operations
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
          Manage courses, accounts, and a light activity feed. Changes here affect
          the whole platform.
        </p>

        {loadError ? (
          <div
            className="mt-5 rounded-lg border px-3 py-3 text-xs leading-relaxed"
            style={{
              borderColor: `${ACCENT}55`,
              backgroundColor: `${ACCENT}0d`,
              color: INK,
            }}
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
              iconClass="text-zinc-400"
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
              iconClass="text-zinc-400"
            />
          </div>
        ) : null}

        {!fatalConfigError ? (
          <section className="mt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-zinc-900">
                  User directory
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">
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
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/15"
                />
              </label>
            </div>

            {usersError ? (
              <div
                className="mt-3 rounded-lg border px-3 py-2 text-xs text-zinc-700"
                style={{
                  borderColor: `${ACCENT}44`,
                  backgroundColor: `${ACCENT}08`,
                }}
              >
                Could not load Auth users: {usersError}
              </div>
            ) : null}

            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-sm">
              <div className={TABLE_BODY_SCROLL}>
                <table className="min-w-full border-collapse text-left">
                  <thead className="sticky top-0 z-[1] border-b border-zinc-200 bg-zinc-100/95 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] backdrop-blur-sm">
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
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
                  <tbody className="text-xs text-zinc-600">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-8 text-center text-xs text-zinc-400"
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
                            index % 2 === 0 ? "bg-white" : "bg-zinc-50/60"
                          }
                        >
                          <td className="border-t border-zinc-100/90 px-3 py-2 sm:px-3.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="font-medium text-zinc-800"
                                style={{ color: INK }}
                              >
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
                                <span className="text-[11px] text-zinc-500">
                                  {u.displayName}
                                </span>
                              ) : null}
                              {u.username ? (
                                <span className="text-[11px] text-zinc-400">
                                  @{u.username}
                                </span>
                              ) : null}
                              <span className="font-mono text-[10px] text-zinc-400">
                                {u.id.slice(0, 12)}…
                              </span>
                              <CopyTextButton text={u.id} label="Copy user ID" />
                            </div>
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 text-zinc-600 lg:table-cell lg:px-3.5">
                            {u.displayName?.trim() || "—"}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 text-zinc-600 xl:table-cell xl:px-3.5">
                            {u.username ? (
                              <span className="font-mono text-[11px]">
                                @{u.username}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 md:table-cell md:px-3.5">
                            <div className="flex max-w-[11rem] items-center gap-1">
                              <span
                                className="truncate font-mono text-[10px] text-zinc-500"
                                title={u.id}
                              >
                                {u.id}
                              </span>
                              <CopyTextButton text={u.id} label="Copy user ID" />
                            </div>
                          </td>
                          <td className="border-t border-zinc-100/90 px-3 py-2 text-[11px] text-zinc-500 sm:px-3.5">
                            <time dateTime={u.signedUpAt}>
                              {formatWhenCompact(u.signedUpAt)}
                            </time>
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 text-[11px] text-zinc-500 lg:table-cell lg:px-3.5">
                            {u.lastSignInAt ? (
                              <time dateTime={u.lastSignInAt}>
                                {formatWhenCompact(u.lastSignInAt)}
                              </time>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 sm:table-cell sm:px-3.5">
                            {u.emailConfirmedAt ? (
                              <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-600/12">
                                Yes
                              </span>
                            ) : (
                              <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-600/15">
                                Pending
                              </span>
                            )}
                          </td>
                          <td className="hidden border-t border-zinc-100/90 px-3 py-2 xl:table-cell xl:px-3.5">
                            {u.onboardingCompletedAt ? (
                              <span className="text-[11px] text-emerald-700">
                                Done
                              </span>
                            ) : (
                              <span className="text-[11px] text-zinc-400">—</span>
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
                <h2 className="text-base font-semibold tracking-tight text-zinc-900">
                  All courses
                </h2>
                <span className="rounded-md bg-zinc-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
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
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/15"
                />
              </label>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-sm">
              <div className={TABLE_BODY_SCROLL}>
                <table className="min-w-full border-collapse text-left">
                  <thead className="sticky top-0 z-[1] border-b border-zinc-200 bg-zinc-100/95 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] backdrop-blur-sm">
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
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
                  <tbody className="text-xs text-zinc-600">
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-8 text-center text-xs text-zinc-400"
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
                                ? "bg-white"
                                : "bg-zinc-50/60"
                            }
                          >
                            <td className="border-t border-zinc-100/90 px-3 py-2 sm:px-3.5">
                              <span
                                className="font-medium text-zinc-800"
                                style={{ color: INK }}
                              >
                                {c.title?.trim() || "Untitled"}
                              </span>
                              <div className="mt-1 md:hidden">
                                <span className="font-mono text-[10px] text-zinc-400">
                                  {c.user_id.slice(0, 10)}…
                                </span>
                                <CopyTextButton
                                  text={c.user_id}
                                  label="Copy owner ID"
                                />
                              </div>
                            </td>
                            <td className="hidden border-t border-zinc-100/90 px-3 py-2 md:table-cell md:px-3.5">
                              <div className="flex max-w-[14rem] items-center gap-1">
                                <span
                                  className="truncate font-mono text-[10px] text-zinc-500"
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
                            <td className="border-t border-zinc-100/90 px-3 py-2 sm:px-3.5">
                              {isPublic ? (
                                <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-600/12">
                                  Public
                                </span>
                              ) : (
                                <span className="inline-flex rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-300/50">
                                  Private
                                </span>
                              )}
                            </td>
                            <td className="border-t border-zinc-100/90 px-3 py-2 text-right sm:px-3.5">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <Link
                                  href={`/dashboard/courses/${c.id}`}
                                  className="inline-flex rounded-md border border-zinc-200/90 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50"
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
                                  className="inline-flex rounded-md px-2 py-1 text-[10px] font-semibold text-white transition enabled:hover:opacity-90 disabled:opacity-50"
                                  style={{ backgroundColor: ACCENT }}
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
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">
              Activity timeline
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">
              Recent course creations and sign-ups — not a full audit log.
            </p>
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-sm">
              <ul
                className={`divide-y divide-zinc-100 ${ACTIVITY_SCROLL}`}
                role="list"
              >
                {activity.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-3.5"
                  >
                    <div>
                      <p className="text-[11px] font-semibold text-zinc-700">
                        {a.detail}
                      </p>
                      <p className="text-xs text-zinc-500">{a.title}</p>
                    </div>
                    <time
                      className="shrink-0 text-[10px] font-medium text-zinc-400 sm:text-right"
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
