"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { UserProfileRow } from "@/types/profile";

const COMMON_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const STUDY_FOCUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Select" },
  { value: "student", label: "Student" },
  { value: "instructor", label: "Instructor / TA" },
  { value: "professional", label: "Working professional" },
  { value: "hobby", label: "Hobby learner" },
  { value: "other", label: "Other" },
];

const FIELD =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800/80 sm:max-w-xs md:max-w-sm";

const FIELD_WIDE =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800/80 md:max-w-lg";

const SELECT_CHEVRON =
  "appearance-none bg-[length:1rem] bg-[right_0.65rem_center] bg-no-repeat pr-9 dark:bg-[length:1rem]";

type Panel = "general" | "account" | "progress";

function tabToPanel(tab: string | null | undefined): Panel {
  if (tab === "progress") return "progress";
  if (tab === "account") return "account";
  return "general";
}

function SettingsRow({
  label,
  hint,
  children,
  alignTop,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  alignTop?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-3 py-5 sm:flex-row sm:justify-between sm:gap-10 ${alignTop ? "sm:items-start" : "sm:items-center"}`}
    >
      <div className="min-w-0 shrink-0 sm:w-[min(40%,14rem)]">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </p>
        {hint ? (
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 sm:flex sm:justify-end">{children}</div>
    </div>
  );
}

function IconUserCircle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
      />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function IconChart({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
  );
}

type Props = {
  email: string;
  initial: UserProfileRow | null;
  /** Open Progress / Account when landing with `?tab=` (server + client sync). */
  initialPanel?: Panel;
  /** Learning pulse UI (server-rendered slot). */
  progressPanel: ReactNode;
};

export function ProfileSettingsForm({
  email,
  initial,
  initialPanel = "general",
  progressPanel,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [panel, setPanel] = useState<Panel>(initialPanel);

  useEffect(() => {
    setPanel(tabToPanel(searchParams.get("tab")));
  }, [searchParams]);

  function goPanel(next: Panel) {
    setPanel(next);
    if (next === "progress") {
      router.replace("/dashboard/profile?tab=progress", { scroll: false });
    } else if (next === "account") {
      router.replace("/dashboard/profile?tab=account", { scroll: false });
    } else {
      router.replace("/dashboard/profile", { scroll: false });
    }
  }
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [birthday, setBirthday] = useState(
    initial?.birthday ? String(initial.birthday).slice(0, 10) : ""
  );
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "");
  const [studyFocus, setStudyFocus] = useState(initial?.study_focus ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seededTimezone = useRef(false);

  useEffect(() => {
    if (seededTimezone.current) return;
    if ((initial?.timezone ?? "").trim().length > 0) {
      seededTimezone.current = true;
      return;
    }
    seededTimezone.current = true;
    try {
      const guessed = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (guessed) setTimezone(guessed);
    } catch {
      /* ignore */
    }
  }, [initial?.timezone]);

  const avatarLetter = useMemo(() => {
    const n = displayName.trim();
    const base = n || email.split("@")[0] || "?";
    return base[0]?.toUpperCase() ?? "?";
  }, [displayName, email]);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          birthday: birthday.trim() || null,
          bio,
          timezone,
          study_focus: studyFocus,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof j.error === "string" ? j.error : "Could not save settings."
        );
        return;
      }
      setMessage("Saved.");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, [bio, birthday, displayName, router, studyFocus, timezone]);

  const navBtn =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100";
  const navBtnActive =
    "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50";

  const selectChevronStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
  };

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      <aside className="shrink-0 lg:w-56 lg:pt-1">
        <nav
          className="flex flex-row gap-1 overflow-x-auto rounded-2xl border border-zinc-200/90 bg-white/90 p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90 lg:flex-col lg:overflow-visible lg:p-2 lg:shadow-md lg:shadow-zinc-900/5 dark:lg:shadow-black/40"
          aria-label="Settings sections"
        >
          <button
            type="button"
            onClick={() => goPanel("general")}
            className={`${navBtn} shrink-0 ${panel === "general" ? navBtnActive : ""}`}
          >
            <IconUserCircle className="h-5 w-5 shrink-0 opacity-70" />
            General
          </button>
          <button
            type="button"
            onClick={() => goPanel("account")}
            className={`${navBtn} shrink-0 ${panel === "account" ? navBtnActive : ""}`}
          >
            <IconShield className="h-5 w-5 shrink-0 opacity-70" />
            Account
          </button>
          <button
            type="button"
            onClick={() => goPanel("progress")}
            className={`${navBtn} shrink-0 ${panel === "progress" ? navBtnActive : ""}`}
          >
            <IconChart className="h-5 w-5 shrink-0 opacity-70" />
            Progress
          </button>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-xl shadow-zinc-900/[0.06] ring-1 ring-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40 dark:ring-white/[0.06]">
          {panel === "general" ? (
            <>
              <header className="border-b border-zinc-100 px-6 py-6 dark:border-zinc-800">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  General
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Profile details and how Aroses looks on this device.
                </p>
              </header>

              <div className="px-6">
                <h2 className="pt-6 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Profile
                </h2>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <SettingsRow
                    label="Avatar"
                    hint="Shown in your dashboard header and profile."
                    alignTop
                  >
                    <div className="flex items-center gap-4 sm:justify-end">
                      <div
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-lg font-semibold text-zinc-700 shadow-inner dark:from-zinc-700 dark:to-zinc-600 dark:text-zinc-100"
                        aria-hidden
                      >
                        {avatarLetter}
                      </div>
                      <button
                        type="button"
                        disabled
                        title="Coming soon"
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
                      >
                        Change
                      </button>
                    </div>
                  </SettingsRow>

                  <SettingsRow
                    label="Full name"
                    hint="Used across your workspace when we greet you or label activity."
                  >
                    <input
                      id="display_name"
                      type="text"
                      autoComplete="name"
                      maxLength={120}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className={FIELD}
                    />
                  </SettingsRow>

                  <SettingsRow
                    label="Birthday"
                    hint="Optional. Private to your account."
                  >
                    <input
                      id="birthday"
                      type="date"
                      value={birthday}
                      onChange={(e) => setBirthday(e.target.value)}
                      className={`${FIELD} dark:[color-scheme:dark]`}
                    />
                  </SettingsRow>

                  <SettingsRow
                    label="What best describes you?"
                    hint="Helps us tune defaults over time (courses, reminders)."
                  >
                    <select
                      value={studyFocus}
                      onChange={(e) => setStudyFocus(e.target.value)}
                      style={selectChevronStyle}
                      className={`${FIELD} ${SELECT_CHEVRON} cursor-pointer`}
                    >
                      {STUDY_FOCUS_OPTIONS.map((o) => (
                        <option key={o.value || "empty"} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </SettingsRow>

                  <SettingsRow
                    label="Study goals & notes"
                    hint="Context we can use for summaries and study chat — keep it short."
                    alignTop
                  >
                    <div className="w-full md:max-w-lg">
                      <textarea
                        id="bio"
                        rows={5}
                        maxLength={500}
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="e.g. MCB 32 final in May — focus on renal & cardio units."
                        className={`${FIELD_WIDE} resize-y`}
                      />
                      <p className="mt-2 text-right text-xs text-zinc-400">
                        {bio.length}/500
                      </p>
                    </div>
                  </SettingsRow>
                </div>

                <h2 className="pt-10 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Preferences
                </h2>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <SettingsRow
                    label="Time zone"
                    hint="Used when we show dates or rhythm charts."
                  >
                    <input
                      id="timezone"
                      type="text"
                      list="common-timezones"
                      maxLength={100}
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="e.g. America/New_York"
                      className={FIELD}
                    />
                    <datalist id="common-timezones">
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </SettingsRow>

                  <SettingsRow
                    label="Appearance"
                    hint="Stored on this browser — light, dark, or match the system."
                  >
                    <div className="flex justify-end">
                      <ThemeToggle />
                    </div>
                  </SettingsRow>
                </div>
              </div>

              <footer className="sticky bottom-0 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-white/95 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                <div className="min-w-0">
                  {message ? (
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {message}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">
                      {error}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      Changes apply after you save.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </footer>
            </>
          ) : panel === "account" ? (
            <>
              <header className="border-b border-zinc-100 px-6 py-6 dark:border-zinc-800">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Account
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Sign-in, password, and session.
                </p>
              </header>

              <div className="space-y-6 px-6 py-6">
                <div className="flex gap-4 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm dark:bg-zinc-800">
                    <IconShield className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      Secure your account
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      Use a strong, unique password. If you sign in with email,
                      you can request a reset link anytime from the login page.
                    </p>
                    <Link
                      href="/login"
                      className="mt-3 inline-flex rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Open login & forgot password
                    </Link>
                  </div>
                </div>

                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <SettingsRow label="Email">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 sm:text-right">
                      {email}
                    </p>
                  </SettingsRow>

                  <SettingsRow
                    label="Password"
                    hint="We never store your password in plain text."
                  >
                    <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400 sm:text-right">
                      Reset via email from{" "}
                      <Link
                        href="/login"
                        className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-200"
                      >
                        login → Forgot password
                      </Link>
                      .
                    </p>
                  </SettingsRow>

                  <SettingsRow
                    label="Session"
                    hint="Sign out on this device."
                    alignTop
                  >
                    <div className="flex justify-end">
                      <LogoutButton className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900" />
                    </div>
                  </SettingsRow>
                </div>
              </div>
            </>
          ) : (
            <div className="px-4 pb-8 pt-4 sm:px-6 sm:pb-10">{progressPanel}</div>
          )}
        </div>
      </div>
    </div>
  );
}
