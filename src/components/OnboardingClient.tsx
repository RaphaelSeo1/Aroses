"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INTRO_HREF } from "@/lib/brand";
import {
  ageFromYmd,
  ONBOARDING_GOALS,
  ONBOARDING_PERSONAS,
  ONBOARDING_REFERRALS,
  parseUsername,
  phasesForPersona,
  type OnboardingGoal,
  type OnboardingPersona,
  type OnboardingPhase,
  type OnboardingReferral,
} from "@/lib/onboarding";
import { filterSchoolSuggestions } from "@/lib/school-suggestions";

const HEADING_SERIF =
  "font-serif tracking-tight text-brand-ink text-balance dark:text-brand-ink";

/**
 * Light-only onboarding surface. When `html.dark` is set, `body` uses a light
 * foreground color — without explicit `dark:` overrides, white cards inherit
 * that color (invisible text on white). Force the same palette as light mode.
 */
const ONBOARDING_LIGHT =
  "[color-scheme:light] dark:bg-[#f6f6f4] dark:text-zinc-900";
const SHELL = `min-h-screen bg-[#f6f6f4] text-zinc-900 antialiased ${ONBOARDING_LIGHT}`;
const PANEL =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-[0_2px_24px_-12px_rgba(0,0,0,0.08)] dark:border-zinc-200/80 dark:bg-white";

const BTN_PRIMARY =
  "inline-flex min-w-[9rem] items-center justify-center rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-black/[0.06] transition hover:bg-brand-hover disabled:pointer-events-none disabled:opacity-45 dark:bg-brand dark:text-white dark:hover:bg-brand-hover";

const BTN_SECONDARY =
  "inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-200 dark:bg-white dark:text-zinc-700 dark:hover:border-zinc-300 dark:hover:bg-zinc-50";

function monthDays(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return false;
  }
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

/** When month/year changes, keep the chosen day if still valid; clamp e.g. Feb 31 → 28/29. */
function reconcileBirthDayAfterCalendarChange(
  dayStr: string,
  yStr: string,
  mStr: string
): string {
  if (!mStr) return "";
  if (!dayStr) return "";
  if (!yStr) return dayStr;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dayStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return "";
  }
  const max = monthDays(y, m);
  if (d < 1) return "";
  if (d > max) return String(max);
  return dayStr;
}

function IconArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

export function OnboardingClient() {
  const router = useRouter();
  const [persona, setPersona] = useState<OnboardingPersona | null>(null);
  const [goals, setGoals] = useState<Set<OnboardingGoal>>(new Set());
  const [schoolName, setSchoolName] = useState("");
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [referral, setReferral] = useState<OnboardingReferral | null>(null);
  const [phase, setPhase] = useState<OnboardingPhase>("welcome");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");

  const phases = useMemo(() => phasesForPersona(persona), [persona]);

  useEffect(() => {
    if (phases.includes(phase)) return;
    // Persona changed (e.g. away from student) — "school" may no longer exist in the flow.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- realign wizard step with allowed phases
    setPhase("goals");
  }, [persona, phases, phase]);

  const phaseIndex = phases.indexOf(phase);
  const progress =
    phaseIndex >= 0 ? ((phaseIndex + 1) / phases.length) * 100 : 6;

  const yNum = birthYear ? Number(birthYear) : NaN;
  const mNum = birthMonth ? Number(birthMonth) : NaN;
  const dNum = birthDay ? Number(birthDay) : NaN;

  const dobFilled =
    Boolean(birthYear && birthMonth && birthDay) &&
    isValidCalendarDate(yNum, mNum, dNum);

  const dobAge = dobFilled ? ageFromYmd(yNum, mNum, dNum) : NaN;
  const dobUnderage = phase === "dob" && dobFilled && dobAge < 13;
  const ageOk = dobFilled && dobAge >= 13;

  const parsedUsername = useMemo(() => parseUsername(username), [username]);

  useEffect(() => {
    if (!parsedUsername) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync validation with input
      setUsernameStatus(username.trim().length === 0 ? "idle" : "invalid");
      return;
    }
    const t = setTimeout(() => {
      setUsernameStatus("checking");
      void (async () => {
        try {
          const res = await fetch(
            `/api/profile/username-available?u=${encodeURIComponent(username)}`
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
  }, [parsedUsername, username]);

  const goNext = useCallback(() => {
    const i = phases.indexOf(phase);
    if (i < 0 || i >= phases.length - 1) return;
    setSubmitError(null);
    setPhase(phases[i + 1]!);
  }, [phase, phases]);

  const goBack = useCallback(() => {
    const i = phases.indexOf(phase);
    if (i <= 0) return;
    setSubmitError(null);
    setPhase(phases[i - 1]!);
  }, [phase, phases]);

  const toggleGoal = (g: OnboardingGoal) => {
    setGoals((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const schoolSuggestions = useMemo(
    () => filterSchoolSuggestions(schoolName, 10),
    [schoolName]
  );

  const canNext = useMemo(() => {
    switch (phase) {
      case "welcome":
        return true;
      case "persona":
        return persona != null;
      case "goals":
        return goals.size > 0;
      case "school":
        return true;
      case "username":
        return usernameStatus === "available";
      case "dob":
        return ageOk;
      case "referral":
        return referral != null;
      default:
        return false;
    }
  }, [phase, persona, goals, usernameStatus, ageOk, referral]);

  async function completeOnboarding() {
    if (!persona || !referral || goals.size === 0) return;
    const u = parseUsername(username);
    if (!u || usernameStatus !== "available") return;
    if (!ageOk || !dobFilled) return;
    const birthday = `${String(yNum).padStart(4, "0")}-${String(mNum).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          studyGoals: [...goals],
          schoolName: schoolName.trim() || null,
          username: u,
          birthday,
          referralSource: referral,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        const base =
          typeof j.error === "string" ? j.error : "Could not finish setup.";
        const withCode =
          typeof j.code === "string" && j.code.length > 0
            ? `${base} [${j.code}]`
            : base;
        setSubmitError(withCode);
        setSubmitting(false);
        return;
      }
      await router.refresh();
      setPhase("done");
    } catch {
      setSubmitError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  async function leaveUnderage() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace(INTRO_HREF);
    router.refresh();
  }

  const maxDay =
    birthMonth !== ""
      ? monthDays(Number.isFinite(yNum) ? yNum : 2020, Number(birthMonth))
      : 31;
  const yearNow = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let y = yearNow - 13; y >= yearNow - 100; y--) yearOptions.push(y);

  if (dobUnderage) {
    return (
      <div className={`flex flex-col ${SHELL}`}>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16 text-center">
          <h1 className={`text-2xl sm:text-3xl ${HEADING_SERIF}`}>
            Aroses is for ages 13 and up
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-600">
            Thanks for your interest. When you&apos;re 13 or older, we&apos;d love
            to have you back.
          </p>
          <div className="mx-auto mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => {
                setBirthYear("");
                setBirthMonth("");
                setBirthDay("");
              }}
              className={BTN_SECONDARY}
            >
              Adjust birthday
            </button>
            <button
              type="button"
              onClick={() => void leaveUnderage()}
              className={BTN_PRIMARY}
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepLabel =
    phaseIndex >= 0 ? `Step ${phaseIndex + 1} of ${phases.length}` : "";

  const cardBase =
    "group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-zinc-200/90 bg-white p-4 text-left text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-200/90 dark:bg-white dark:text-zinc-900 sm:flex-row sm:items-center sm:gap-3.5 sm:p-4";
  const cardSelected =
    "border-brand bg-brand-blush shadow-[0_2px_14px_-6px_rgba(220,38,38,0.28)] ring-1 ring-brand/25 dark:border-brand dark:bg-brand-blush dark:shadow-[0_2px_14px_-6px_rgba(220,38,38,0.28)] dark:ring-brand/25";

  const emojiWrap =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-[1.1rem] leading-none shadow-inner dark:bg-zinc-100 sm:h-10 sm:w-10 sm:text-[1.2rem]";

  return (
    <div className={`relative flex flex-col ${SHELL}`}>
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/95 shadow-sm backdrop-blur-md dark:border-zinc-200/80 dark:bg-white/95">
        <div className="h-1.5 bg-zinc-200 dark:bg-zinc-200" aria-hidden>
          <div
            className="h-full bg-brand transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-3.5 sm:px-8">
          <div className="justify-self-start">
            {phase !== "welcome" && phase !== "done" ? (
              <button
                type="button"
                onClick={goBack}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-200 dark:bg-white dark:text-zinc-700 dark:hover:bg-zinc-50"
              >
                ← Back
              </button>
            ) : (
              <span className="inline-block w-px opacity-0" aria-hidden>
                .
              </span>
            )}
          </div>
          <p className="justify-self-center text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
            {phase === "welcome" || phase === "done" ? "Setup" : stepLabel}
          </p>
          <span className="justify-self-end" aria-hidden />
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center px-4 py-8 sm:px-8 sm:py-11">
        <div
          key={phase}
          className="w-full max-w-xl animate-onboarding-step sm:max-w-2xl"
        >
          {phase === "welcome" ? (
            <div className={`${PANEL} px-8 py-12 text-center sm:px-12 sm:py-14`}>
              <h1
                className={`text-[1.75rem] font-semibold leading-tight sm:text-[2.1rem] ${HEADING_SERIF}`}
              >
                Welcome to Aroses
              </h1>
              <p className="mx-auto mt-5 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-600">
                We all know something. Let&apos;s set up your experience.
              </p>
              <button
                type="button"
                onClick={goNext}
                className={`${BTN_PRIMARY} mx-auto mt-10 gap-2`}
              >
                Get started
                <IconArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {phase === "persona" ? (
            <div>
              <h2
                className={`mx-auto max-w-lg text-center text-[1.45rem] font-semibold leading-snug sm:text-[1.65rem] ${HEADING_SERIF}`}
              >
                I am a…
              </h2>
              <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-3.5">
                {ONBOARDING_PERSONAS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPersona(opt.id)}
                    className={`${cardBase} ${persona === opt.id ? cardSelected : ""}`}
                  >
                    <span className={emojiWrap} aria-hidden>
                      {opt.emoji}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <span className="block text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-900 sm:text-base">
                        {opt.label}
                      </span>
                      <span className="block text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-600 sm:text-sm">
                        {opt.hint}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {phase === "goals" ? (
            <div>
              <h2
                className={`mx-auto max-w-lg text-center text-[1.45rem] font-semibold leading-snug sm:text-[1.65rem] ${HEADING_SERIF}`}
              >
                I&apos;m here to…
              </h2>
              <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-500">
                Select all that apply.
              </p>
              <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-3.5">
                {ONBOARDING_GOALS.map((opt) => {
                  const on = goals.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleGoal(opt.id)}
                      className={`${cardBase} ${on ? cardSelected : ""}`}
                    >
                      <span className={emojiWrap} aria-hidden>
                        {opt.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-900 sm:text-base">
                          {opt.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {phase === "school" ? (
            <div className={`${PANEL} mx-auto max-w-lg px-6 py-8 sm:px-8 sm:py-10`}>
              <h2
                className={`text-center text-[1.45rem] font-semibold leading-snug sm:text-[1.65rem] ${HEADING_SERIF}`}
              >
                Where do you study or teach?
              </h2>
              <p className="mx-auto mt-3 text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-500">
                Start typing for suggestions, or skip for now.
              </p>
              <div className="relative mx-auto mt-8 w-full">
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => {
                    setSchoolName(e.target.value);
                    setSchoolOpen(true);
                  }}
                  onFocus={() => setSchoolOpen(true)}
                  onBlur={() => setTimeout(() => setSchoolOpen(false), 180)}
                  placeholder="University or school name"
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 py-3.5 text-sm text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20 dark:border-zinc-200 dark:bg-zinc-50/50 dark:text-zinc-900 dark:placeholder:text-zinc-400 dark:focus:bg-white"
                  autoComplete="off"
                />
                {schoolOpen && schoolSuggestions.length > 0 ? (
                  <ul
                    className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-200 dark:bg-white"
                    role="listbox"
                  >
                    {schoolSuggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          className="w-full px-4 py-2.5 text-left text-zinc-800 hover:bg-zinc-50 dark:text-zinc-800 dark:hover:bg-zinc-50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSchoolName(s);
                            setSchoolOpen(false);
                          }}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="mx-auto mt-8 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={goNext} className={BTN_PRIMARY}>
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSchoolName("");
                    goNext();
                  }}
                  className={BTN_SECONDARY}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : null}

          {phase === "username" ? (
            <div className={`${PANEL} mx-auto max-w-md px-6 py-8 text-center sm:px-8`}>
              <h2
                className={`text-[1.45rem] font-semibold leading-snug sm:text-[1.65rem] ${HEADING_SERIF}`}
              >
                Choose your username
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-600">
                This is how others will see you on Aroses.
              </p>
              <div className="relative mx-auto mt-8 text-left">
                <input
                  type="text"
                  value={username}
                  onChange={(e) =>
                    setUsername(
                      e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")
                    )
                  }
                  placeholder="letters_numbers"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-3.5 pl-4 pr-12 text-sm text-zinc-900 shadow-inner outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20 dark:border-zinc-200 dark:bg-zinc-50/50 dark:text-zinc-900 dark:focus:bg-white"
                  maxLength={30}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
                  {usernameStatus === "checking" ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand" />
                  ) : usernameStatus === "available" ? (
                    <IconCheck className="h-5 w-5 text-emerald-600" />
                  ) : usernameStatus === "taken" || usernameStatus === "invalid" ? (
                    username.trim().length > 0 ? (
                      <IconX className="h-5 w-5 text-red-600" />
                    ) : null
                  ) : null}
                </span>
              </div>
              {usernameStatus === "invalid" && username.length > 0 ? (
                <p className="mt-2 text-left text-xs text-red-600">
                  Use 3–30 characters: lowercase letters, numbers, underscores.
                </p>
              ) : null}
              {usernameStatus === "taken" ? (
                <p className="mt-2 text-left text-xs text-red-600">
                  That username is taken. Try another.
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === "dob" ? (
            <div className={`${PANEL} mx-auto max-w-lg px-6 py-8 text-center sm:px-8 sm:py-10`}>
              <h2
                className={`text-[1.45rem] font-semibold leading-snug sm:text-[1.65rem] ${HEADING_SERIF}`}
              >
                When were you born?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-600">
                We use this to personalize your experience. You must be 13 or older
                to use Aroses.
              </p>
              <div className="mx-auto mt-8 flex max-w-md flex-wrap items-end justify-center gap-4">
                <label className="flex flex-col text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                  Month
                  <select
                    value={birthMonth}
                    onChange={(e) => {
                      const nextM = e.target.value;
                      setBirthMonth(nextM);
                      setBirthDay((prev) =>
                        reconcileBirthDayAfterCalendarChange(
                          prev,
                          birthYear,
                          nextM
                        )
                      );
                    }}
                    className="mt-2 min-w-[10.5rem] rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-zinc-200 dark:bg-white dark:text-zinc-900"
                  >
                    <option value="">Month</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={String(m)}>
                        {new Date(2000, m - 1, 1).toLocaleString("default", {
                          month: "long",
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                  Day
                  <select
                    value={birthDay}
                    onChange={(e) => setBirthDay(e.target.value)}
                    className="mt-2 min-w-[6.5rem] rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-zinc-200 dark:bg-white dark:text-zinc-900"
                  >
                    <option value="">Day</option>
                    {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d)}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                  Year
                  <select
                    value={birthYear}
                    onChange={(e) => {
                      const nextY = e.target.value;
                      setBirthYear(nextY);
                      setBirthDay((prev) =>
                        reconcileBirthDayAfterCalendarChange(
                          prev,
                          nextY,
                          birthMonth
                        )
                      );
                    }}
                    className="mt-2 min-w-[7.5rem] rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-zinc-200 dark:bg-white dark:text-zinc-900"
                  >
                    <option value="">Year</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {phase === "referral" ? (
            <div>
              <h2
                className={`mx-auto max-w-lg text-center text-[1.45rem] font-semibold leading-snug sm:text-[1.65rem] ${HEADING_SERIF}`}
              >
                How did you find Aroses?
              </h2>
              <div className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3">
                {ONBOARDING_REFERRALS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setReferral(opt.id)}
                    className={`${cardBase} ${referral === opt.id ? cardSelected : ""}`}
                  >
                    <span className={emojiWrap} aria-hidden>
                      {opt.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-900 sm:text-base">
                        {opt.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className={`${PANEL} px-8 py-12 text-center sm:px-10 sm:py-14`}>
              <h1
                className={`text-[1.65rem] font-semibold leading-tight sm:text-[2rem] ${HEADING_SERIF}`}
              >
                You&apos;re all set, {parseUsername(username) ?? "friend"}!
              </h1>
              <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-600">
                Your Aroses account is ready. Start by creating your first course or
                exploring what others have made.
              </p>
              <div className="mx-auto mt-10 flex max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/dashboard/courses/new"
                  className={`${BTN_PRIMARY} flex-1 gap-2 sm:flex-initial`}
                >
                  Create a course
                  <IconArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/explore"
                  className={`${BTN_SECONDARY} flex-1 gap-2 font-semibold sm:flex-initial`}
                >
                  Explore courses
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : null}

          {submitError ? (
            <div
              className="mx-auto mt-8 max-w-lg rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm leading-relaxed text-red-800 dark:border-red-200 dark:bg-red-50 dark:text-red-900"
              role="alert"
            >
              {submitError}
            </div>
          ) : null}

          {phase !== "welcome" &&
          phase !== "school" &&
          phase !== "done" &&
          phase !== "username" &&
          phase !== "dob" ? (
            <div className="mx-auto mt-8 flex justify-center sm:mt-9">
              <button
                type="button"
                disabled={!canNext || (phase === "referral" && submitting)}
                onClick={() => {
                  if (phase === "referral") {
                    void completeOnboarding();
                    return;
                  }
                  goNext();
                }}
                className={BTN_PRIMARY}
              >
                {phase === "referral"
                  ? submitting
                    ? "Saving…"
                    : "Finish"
                  : "Continue"}
              </button>
            </div>
          ) : null}

          {phase === "username" ? (
            <div className="mx-auto mt-8 flex justify-center sm:mt-9">
              <button
                type="button"
                disabled={!canNext}
                onClick={goNext}
                className={BTN_PRIMARY}
              >
                Continue
              </button>
            </div>
          ) : null}

          {phase === "dob" ? (
            <div className="mx-auto mt-8 flex justify-center sm:mt-9">
              <button
                type="button"
                disabled={!canNext}
                onClick={goNext}
                className={BTN_PRIMARY}
              >
                Continue
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
