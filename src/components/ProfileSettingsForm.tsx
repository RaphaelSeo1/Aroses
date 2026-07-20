"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isUiLocaleSwitcherEnabled } from "@/lib/i18n/config";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { createClient } from "@/lib/supabase/client";
import { getBrowserAuthOrigin } from "@/lib/site-url";
import { replaceProfileUrl } from "@/lib/messaging/profile-url";
import { parseUsername } from "@/lib/onboarding";
import type { UserProfileRow } from "@/types/profile";

type Panel = "general" | "account" | "progress";

// Values are stored in the DB as-is; only display labels are translated.
const STUDY_FOCUS_VALUES = [
  "",
  "student",
  "instructor",
  "professional",
  "hobby",
  "other",
] as const;

const FIELD =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800/80 sm:max-w-xs md:max-w-sm";

const FIELD_WIDE =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800/80 md:max-w-lg";

const SELECT_CHEVRON =
  "appearance-none bg-[length:1rem] bg-[right_0.65rem_center] bg-no-repeat pr-9 dark:bg-[length:1rem]";

async function fileToResizedJpegBlob(file: File, maxEdge: number): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    img.close();
    throw new Error("Could not prepare image.");
  }
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88)
  );
  if (!blob) throw new Error("Could not encode image.");
  return blob;
}

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
  /** Profile → Progress panel (server-rendered slot). */
  progressPanel: ReactNode;
};

export function ProfileSettingsForm({
  email,
  initial,
  initialPanel = "general",
  progressPanel,
}: Props) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [panel, setPanel] = useState<Panel>(initialPanel);

  useEffect(() => {
    setPanel(tabToPanel(searchParams.get("tab")));
  }, [searchParams]);

  const [visitedPanels, setVisitedPanels] = useState<Set<Panel>>(
    () => new Set([initialPanel])
  );

  useEffect(() => {
    setVisitedPanels((prev) => {
      if (prev.has(panel)) return prev;
      const next = new Set(prev);
      next.add(panel);
      return next;
    });
  }, [panel]);

  function goPanel(next: Panel) {
    setPanel(next);
    if (next === "general") {
      replaceProfileUrl({ tab: undefined, conversation: null });
    } else {
      replaceProfileUrl({ tab: next, conversation: null });
    }
  }
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [usernameInput, setUsernameInput] = useState(initial?.username ?? "");
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [birthday, setBirthday] = useState(
    initial?.birthday ? String(initial.birthday).slice(0, 10) : ""
  );
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [studyFocus, setStudyFocus] = useState(initial?.study_focus ?? "");
  const [schoolName, setSchoolName] = useState(initial?.school_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial?.avatar_url ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [passwordResetMessage, setPasswordResetMessage] = useState<string | null>(
    null
  );
  const [passwordResetError, setPasswordResetError] = useState<string | null>(
    null
  );

  useEffect(() => {
    // Keep in sync when `router.refresh()` updates server-passed `initial`.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop → state sync
    setAvatarUrl(initial?.avatar_url ?? null);
  }, [initial?.avatar_url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop → state sync
    setSchoolName(initial?.school_name ?? "");
  }, [initial?.school_name]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop → state sync
    setUsernameInput(initial?.username ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop → state sync
    setUsernameDirty(false);
  }, [initial?.username]);

  const normalizedInitialUsername = useMemo(
    () => (initial?.username ? parseUsername(initial.username) : null),
    [initial?.username]
  );

  const parsedUsername = useMemo(
    () => parseUsername(usernameInput),
    [usernameInput]
  );

  useEffect(() => {
    if (!parsedUsername) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync validation with input
      setUsernameStatus(usernameInput.trim().length === 0 ? "idle" : "invalid");
      return;
    }
    if (
      normalizedInitialUsername &&
      parsedUsername === normalizedInitialUsername
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- current handle is valid
      setUsernameStatus("available");
      return;
    }
    const t = setTimeout(() => {
      setUsernameStatus("checking");
      void (async () => {
        try {
          const res = await fetch(
            `/api/profile/username-available?u=${encodeURIComponent(usernameInput)}`
          );
          const j = (await res.json()) as {
            available?: boolean;
            ok?: boolean;
          };
          if (!res.ok) {
            setUsernameStatus("invalid");
            return;
          }
          setUsernameStatus(j.available ? "available" : "taken");
        } catch {
          setUsernameStatus("invalid");
        }
      })();
    }, 380);
    return () => clearTimeout(t);
  }, [parsedUsername, usernameInput, normalizedInitialUsername]);

  const avatarLetter = useMemo(() => {
    const n = displayName.trim();
    const base = n || email.split("@")[0] || "?";
    return base[0]?.toUpperCase() ?? "?";
  }, [displayName, email]);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const nextUsername = parseUsername(usernameInput);
    const body: Record<string, unknown> = {
      display_name: displayName,
      birthday: birthday.trim() || null,
      bio,
      study_focus: studyFocus,
      school_name: schoolName.trim() || null,
    };

    if (usernameDirty) {
      if (usernameInput.trim() !== "" && !nextUsername) {
        setError(t.settings.errorUsernameInvalid);
        setBusy(false);
        return;
      }
      if (normalizedInitialUsername && !nextUsername) {
        setError(t.settings.errorUsernameEmpty);
        setBusy(false);
        return;
      }
      if (
        nextUsername &&
        nextUsername !== normalizedInitialUsername &&
        usernameStatus !== "available"
      ) {
        setError(t.settings.errorUsernameUnavailable);
        setBusy(false);
        return;
      }
      if (usernameStatus === "checking") {
        setError(t.settings.errorUsernameChecking);
        setBusy(false);
        return;
      }
      body.username = nextUsername ?? null;
    }

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof j.error === "string" ? j.error : t.settings.errorSaveFailed
        );
        return;
      }
      setMessage(t.settings.saved);
      router.refresh();
    } catch {
      setError(t.settings.errorNetwork);
    } finally {
      setBusy(false);
    }
  }, [
    bio,
    birthday,
    displayName,
    normalizedInitialUsername,
    router,
    schoolName,
    studyFocus,
    t,
    usernameDirty,
    usernameInput,
    usernameStatus,
  ]);

  const sendPasswordReset = useCallback(async () => {
    setPasswordResetBusy(true);
    setPasswordResetMessage(null);
    setPasswordResetError(null);
    try {
      const origin = getBrowserAuthOrigin() || window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo }
      );
      if (resetError) {
        setPasswordResetError(resetError.message);
        return;
      }
      setPasswordResetMessage(tf(t.settings.resetLinkSent, { email }));
    } catch {
      setPasswordResetError(t.settings.errorNetworkRetry);
    } finally {
      setPasswordResetBusy(false);
    }
  }, [email, t]);

  const persistAvatarUrl = useCallback(
    async (nextUrl: string | null) => {
      setMessage(null);
      setError(null);
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar_url: nextUrl }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof j.error === "string" ? j.error : t.settings.errorAvatarUpdate
          );
          return false;
        }
        setAvatarUrl(nextUrl);
        setMessage(nextUrl ? t.settings.avatarUpdated : t.settings.avatarRemoved);
        router.refresh();
        return true;
      } catch {
        setError(t.settings.errorNetwork);
        return false;
      }
    },
    [router, t]
  );

  const onAvatarFile = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError(t.settings.errorChooseImage);
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setError(t.settings.errorImageTooLarge);
        return;
      }
      setMessage(null);
      setError(null);
      setAvatarBusy(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setError(t.settings.errorSignInRequired);
          return;
        }
        const blob = await fileToResizedJpegBlob(file, 512);
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (upErr) {
          setError(upErr.message || t.settings.errorUploadFailed);
          return;
        }
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
        const publicUrl = pub.publicUrl;
        await persistAvatarUrl(publicUrl);
      } catch {
        // Underlying errors (image decode/encode) carry English debug messages;
        // show the localized generic toast instead.
        setError(t.settings.errorProcessImage);
      } finally {
        setAvatarBusy(false);
      }
    },
    [persistAvatarUrl, t]
  );

  const clearAvatar = useCallback(async () => {
    setAvatarBusy(true);
    try {
      await persistAvatarUrl(null);
    } finally {
      setAvatarBusy(false);
    }
  }, [persistAvatarUrl]);

  const navBtn =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100";
  const navBtnActive =
    "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50";

  const studyFocusLabels: Record<(typeof STUDY_FOCUS_VALUES)[number], string> = {
    "": t.settings.studyFocusSelect,
    student: t.settings.studyFocusStudent,
    instructor: t.settings.studyFocusInstructor,
    professional: t.settings.studyFocusProfessional,
    hobby: t.settings.studyFocusHobby,
    other: t.settings.studyFocusOther,
  };

  const selectChevronStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
  };

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      <aside className="shrink-0 lg:w-56 lg:pt-1">
        <nav
          className="flex flex-row gap-1 overflow-x-auto rounded-2xl border border-zinc-200/90 bg-white/90 p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90 lg:flex-col lg:overflow-visible lg:p-2 lg:shadow-md lg:shadow-zinc-900/5 dark:lg:shadow-black/40"
          aria-label={t.settings.settingsSections}
        >
          <button
            type="button"
            onClick={() => goPanel("general")}
            className={`${navBtn} shrink-0 ${panel === "general" ? navBtnActive : ""}`}
          >
            <IconUserCircle className="h-5 w-5 shrink-0 opacity-70" />
            {t.settings.navGeneral}
          </button>
          <button
            type="button"
            onClick={() => goPanel("account")}
            className={`${navBtn} shrink-0 ${panel === "account" ? navBtnActive : ""}`}
          >
            <IconShield className="h-5 w-5 shrink-0 opacity-70" />
            {t.settings.navAccount}
          </button>
          <button
            type="button"
            onClick={() => goPanel("progress")}
            className={`${navBtn} shrink-0 ${panel === "progress" ? navBtnActive : ""}`}
          >
            <IconChart className="h-5 w-5 shrink-0 opacity-70" />
            {t.settings.navProgress}
          </button>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-xl shadow-zinc-900/[0.06] ring-1 ring-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40 dark:ring-white/[0.06]">
          <div className={panel === "general" ? undefined : "hidden"}>
          {visitedPanels.has("general") && (
            <>
              <header className="border-b border-zinc-100 px-6 py-6 dark:border-zinc-800">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {t.settings.generalTitle}
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t.settings.generalSubtitle}
                </p>
              </header>

              <div className="px-6">
                <h2 className="pt-6 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {t.settings.sectionProfile}
                </h2>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <SettingsRow
                    label={t.settings.avatarLabel}
                    hint={t.settings.avatarHint}
                    alignTop
                  >
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          void onAvatarFile(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-provided public Storage URL
                        <img
                          src={avatarUrl}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
                        />
                      ) : (
                        <div
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-lg font-semibold text-zinc-700 shadow-inner dark:from-zinc-700 dark:to-zinc-600 dark:text-zinc-100"
                          aria-hidden
                        >
                          {avatarLetter}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={avatarBusy}
                          onClick={() => avatarInputRef.current?.click()}
                          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
                        >
                          {avatarBusy
                            ? t.settings.avatarWorking
                            : t.settings.avatarChange}
                        </button>
                        {avatarUrl ? (
                          <button
                            type="button"
                            disabled={avatarBusy}
                            onClick={() => void clearAvatar()}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                          >
                            {t.settings.avatarRemove}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </SettingsRow>

                  <SettingsRow
                    label={t.settings.fullNameLabel}
                    hint={t.settings.fullNameHint}
                  >
                    <input
                      id="display_name"
                      type="text"
                      autoComplete="name"
                      maxLength={120}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t.settings.fullNamePlaceholder}
                      className={FIELD}
                    />
                  </SettingsRow>

                  <SettingsRow
                    label={t.settings.usernameLabel}
                    hint={t.settings.usernameHint}
                  >
                    <div className="relative w-full sm:max-w-xs md:max-w-sm">
                      <input
                        id="profile_username"
                        type="text"
                        autoComplete="username"
                        maxLength={30}
                        value={usernameInput}
                        onChange={(e) => {
                          setUsernameDirty(true);
                          setUsernameInput(
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, "")
                          );
                        }}
                        placeholder={t.settings.usernamePlaceholder}
                        className={`${FIELD} pr-10`}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
                        {usernameStatus === "checking" ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-200" />
                        ) : usernameStatus === "available" ? (
                          <span
                            className="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
                            aria-label={t.settings.usernameAvailable}
                          >
                            ✓
                          </span>
                        ) : usernameStatus === "taken" ||
                          usernameStatus === "invalid" ? (
                          usernameInput.trim().length > 0 ? (
                            <span
                              className="text-sm font-semibold text-red-600 dark:text-red-400"
                              aria-label={t.settings.usernameUnavailable}
                            >
                              ✗
                            </span>
                          ) : null
                        ) : null}
                      </span>
                    </div>
                    {usernameStatus === "invalid" && usernameInput.trim() !== "" ? (
                      <p className="mt-2 text-right text-xs text-red-600 dark:text-red-400">
                        {t.settings.usernameInvalidMessage}
                      </p>
                    ) : null}
                    {usernameStatus === "taken" ? (
                      <p className="mt-2 text-right text-xs text-red-600 dark:text-red-400">
                        {t.settings.usernameTakenMessage}
                      </p>
                    ) : null}
                  </SettingsRow>

                  <SettingsRow
                    label={t.settings.birthdayLabel}
                    hint={t.settings.birthdayHint}
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
                    label={t.settings.studyFocusLabel}
                    hint={t.settings.studyFocusHint}
                  >
                    <select
                      value={studyFocus}
                      onChange={(e) => setStudyFocus(e.target.value)}
                      style={selectChevronStyle}
                      className={`${FIELD} ${SELECT_CHEVRON} cursor-pointer`}
                    >
                      {STUDY_FOCUS_VALUES.map((value) => (
                        <option key={value || "empty"} value={value}>
                          {studyFocusLabels[value]}
                        </option>
                      ))}
                    </select>
                  </SettingsRow>

                  <SettingsRow
                    label={t.settings.schoolLabel}
                    hint={t.settings.schoolHint}
                  >
                    <input
                      id="school_name"
                      type="text"
                      autoComplete="organization"
                      maxLength={200}
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      placeholder={t.settings.schoolPlaceholder}
                      className={FIELD}
                    />
                  </SettingsRow>

                  <SettingsRow
                    label={t.settings.bioLabel}
                    hint={t.settings.bioHint}
                    alignTop
                  >
                    <div className="w-full md:max-w-lg">
                      <textarea
                        id="bio"
                        rows={5}
                        maxLength={500}
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder={t.settings.bioPlaceholder}
                        className={`${FIELD_WIDE} resize-y`}
                      />
                      <p className="mt-2 text-right text-xs text-zinc-400">
                        {bio.length}/500
                      </p>
                    </div>
                  </SettingsRow>
                </div>

                <h2 className="pt-10 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {t.settings.sectionPreferences}
                </h2>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <SettingsRow
                    label={t.settings.appearanceLabel}
                    hint={t.settings.appearanceHint}
                  >
                    <div className="flex justify-end">
                      <ThemeToggle />
                    </div>
                  </SettingsRow>

                  {isUiLocaleSwitcherEnabled() ? (
                    <SettingsRow
                      label={t.settings.languageLabel}
                      hint={t.settings.languageHint}
                    >
                      <div className="flex justify-end">
                        <LanguageSwitcher />
                      </div>
                    </SettingsRow>
                  ) : null}
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
                    <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                      {t.settings.footerHelp}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (usernameDirty &&
                      (usernameStatus === "checking" ||
                        usernameStatus === "taken"))
                  }
                  onClick={() => void save()}
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                >
                  {busy ? t.settings.saving : t.settings.saveChanges}
                </button>
              </footer>
            </>
          )}
          </div>

          <div className={panel === "account" ? undefined : "hidden"}>
          {visitedPanels.has("account") && (
            <>
              <header className="border-b border-zinc-100 px-6 py-6 dark:border-zinc-800">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {t.settings.accountTitle}
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t.settings.accountSubtitle}
                </p>
              </header>

              <div className="divide-y divide-zinc-100 px-6 dark:divide-zinc-800">
                <SettingsRow label={t.settings.emailLabel}>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 sm:text-right">
                    {email}
                  </p>
                </SettingsRow>

                <SettingsRow
                  label={t.settings.passwordLabel}
                  hint={t.settings.passwordHint}
                  alignTop
                >
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <button
                      type="button"
                      disabled={passwordResetBusy}
                      onClick={() => void sendPasswordReset()}
                      className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-200"
                    >
                      {passwordResetBusy
                        ? t.settings.sendingResetLink
                        : t.settings.forgotPassword}
                    </button>
                    {passwordResetError ? (
                      <p
                        role="alert"
                        className="max-w-sm text-sm text-red-600 dark:text-red-400 sm:text-right"
                      >
                        {passwordResetError}
                      </p>
                    ) : null}
                    {passwordResetMessage ? (
                      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400 sm:text-right">
                        {passwordResetMessage}
                      </p>
                    ) : null}
                  </div>
                </SettingsRow>

                <SettingsRow
                  label={t.settings.sessionLabel}
                  hint={t.settings.sessionHint}
                  alignTop
                >
                  <div className="flex justify-end">
                    <LogoutButton className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900" />
                  </div>
                </SettingsRow>
              </div>
            </>
          )}
          </div>

          <div className={panel === "progress" ? undefined : "hidden"}>
          {visitedPanels.has("progress") && (
            <div className="px-4 pb-8 pt-4 sm:px-6 sm:pb-10">{progressPanel}</div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

