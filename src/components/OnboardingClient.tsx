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

const HEADING_SERIF = "font-serif tracking-tight text-brand-ink dark:text-zinc-50";

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
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSubmitError(
          typeof j.error === "string" ? j.error : "Could not finish setup."
        );
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
      <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16 text-center">
          <h1 className={`text-3xl sm:text-4xl ${HEADING_SERIF}`}>
            Aroses is for ages 13 and up
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
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
              className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Adjust birthday
            </button>
            <button
              type="button"
              onClick={() => void leaveUnderage()}
              className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover"
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cardBase =
    "flex w-full cursor-pointer rounded-2xl border-2 border-zinc-200/90 bg-white p-4 text-left shadow-sm transition dark:border-zinc-700 dark:bg-zinc-900/80 sm:p-5";
  const cardSelected =
    "border-brand bg-brand-blush ring-1 ring-brand/20 dark:bg-brand-ink/20 dark:ring-brand-soft/30";

  return (
    <div className="relative flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div
        className="fixed inset-x-0 top-0 z-20 h-1 bg-zinc-100 dark:bg-zinc-800"
        aria-hidden
      >
        <div
          className="h-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {phase !== "welcome" && phase !== "done" ? (
        <div className="absolute left-4 top-6 z-10 sm:left-8 sm:top-8">
          <button
            type="button"
            onClick={goBack}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Back
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16">
        <div key={phase} className="w-full max-w-xl animate-onboarding-step">
          {phase === "welcome" ? (
            <div className="text-center">
              <h1 className={`text-4xl font-semibold sm:text-5xl ${HEADING_SERIF}`}>
                Welcome to Aroses
              </h1>
              <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                We all know something. Let&apos;s set up your experience.
              </p>
              <button
                type="button"
                onClick={goNext}
                className="mx-auto mt-12 inline-flex items-center gap-2 rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-brand-hover"
              >
                Get started
                <IconArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {phase === "persona" ? (
            <div>
              <h2 className={`text-center text-2xl font-semibold sm:text-3xl ${HEADING_SERIF}`}>
                I am a…
              </h2>
              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {ONBOARDING_PERSONAS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPersona(opt.id)}
                    className={`${cardBase} ${persona === opt.id ? cardSelected : "hover:border-zinc-300 dark:hover:border-zinc-500"}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      {opt.emoji}
                    </span>
                    <span className="mt-2 block text-base font-semibold text-zinc-900 dark:text-zinc-50">
                      {opt.label}
                    </span>
                    <span className="mt-1 block text-sm leading-snug text-zinc-600 dark:text-zinc-400">
                      {opt.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {phase === "goals" ? (
            <div>
              <h2 className={`text-center text-2xl font-semibold sm:text-3xl ${HEADING_SERIF}`}>
                I&apos;m here to…
              </h2>
              <p className="mx-auto mt-2 max-w-md text-center text-sm text-zinc-500 dark:text-zinc-400">
                Select all that apply.
              </p>
              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {ONBOARDING_GOALS.map((opt) => {
                  const on = goals.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleGoal(opt.id)}
                      className={`${cardBase} ${on ? cardSelected : "hover:border-zinc-300 dark:hover:border-zinc-500"}`}
                    >
                      <span className="text-2xl" aria-hidden>
                        {opt.emoji}
                      </span>
                      <span className="mt-2 block text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {phase === "school" ? (
            <div>
              <h2 className={`text-center text-2xl font-semibold sm:text-3xl ${HEADING_SERIF}`}>
                Where do you study or teach?
              </h2>
              <p className="mx-auto mt-2 max-w-md text-center text-sm text-zinc-500 dark:text-zinc-400">
                Start typing to see suggestions, or skip for now.
              </p>
              <div className="relative mx-auto mt-10 max-w-md">
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
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none ring-0 transition focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-brand-soft"
                  autoComplete="off"
                />
                {schoolOpen && schoolSuggestions.length > 0 ? (
                  <ul
                    className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
                    role="listbox"
                  >
                    {schoolSuggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          className="w-full px-4 py-2.5 text-left text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
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
              <div className="mx-auto mt-8 flex max-w-md flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSchoolName("");
                    goNext();
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Skip
                </button>
              </div>
            </div>
          ) : null}

          {phase === "username" ? (
            <div className="mx-auto max-w-md text-center">
              <h2 className={`text-2xl font-semibold sm:text-3xl ${HEADING_SERIF}`}>
                Choose your username
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                This is how others will see you on Aroses.
              </p>
              <div className="relative mt-8">
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
                  className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-4 pr-12 text-left text-sm text-zinc-900 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
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
            <div className="mx-auto max-w-lg text-center">
              <h2 className={`text-2xl font-semibold sm:text-3xl ${HEADING_SERIF}`}>
                When were you born?
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                We use this to personalize your experience. You must be 13 or older
                to use Aroses.
              </p>
              <div className="mx-auto mt-10 flex max-w-md flex-wrap items-end justify-center gap-3">
                <label className="flex flex-col text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Month
                  <select
                    value={birthMonth}
                    onChange={(e) => {
                      setBirthMonth(e.target.value);
                      setBirthDay("");
                    }}
                    className="mt-1.5 min-w-[10rem] rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
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
                <label className="flex flex-col text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Day
                  <select
                    value={birthDay}
                    onChange={(e) => setBirthDay(e.target.value)}
                    className="mt-1.5 min-w-[6rem] rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
                  >
                    <option value="">Day</option>
                    {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d)}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Year
                  <select
                    value={birthYear}
                    onChange={(e) => {
                      setBirthYear(e.target.value);
                      setBirthDay("");
                    }}
                    className="mt-1.5 min-w-[7rem] rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
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
              <h2 className={`text-center text-2xl font-semibold sm:text-3xl ${HEADING_SERIF}`}>
                How did you find Aroses?
              </h2>
              <div className="mx-auto mt-10 grid max-w-xl gap-3 sm:grid-cols-2">
                {ONBOARDING_REFERRALS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setReferral(opt.id)}
                    className={`${cardBase} ${referral === opt.id ? cardSelected : "hover:border-zinc-300 dark:hover:border-zinc-500"}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      {opt.emoji}
                    </span>
                    <span className="mt-2 block text-base font-semibold text-zinc-900 dark:text-zinc-50">
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="text-center">
              <h1 className={`text-3xl font-semibold sm:text-4xl ${HEADING_SERIF}`}>
                You&apos;re all set, {parseUsername(username) ?? "friend"}!
              </h1>
              <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Your Aroses account is ready. Start by creating your first course or
                exploring what others have made.
              </p>
              <div className="mx-auto mt-10 flex max-w-lg flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/dashboard/courses/new"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover sm:flex-initial"
                >
                  Create a course
                  <IconArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/explore"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 sm:flex-initial"
                >
                  Explore courses
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : null}

          {submitError ? (
            <p className="mx-auto mt-6 max-w-md text-center text-sm text-red-600">
              {submitError}
            </p>
          ) : null}

          {phase !== "welcome" &&
          phase !== "school" &&
          phase !== "done" &&
          phase !== "username" &&
          phase !== "dob" ? (
            <div className="mx-auto mt-12 flex max-w-md justify-center">
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
                className="inline-flex min-w-[12rem] items-center justify-center rounded-full bg-brand px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
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
            <div className="mx-auto mt-12 flex max-w-md justify-center">
              <button
                type="button"
                disabled={!canNext}
                onClick={goNext}
                className="inline-flex min-w-[12rem] items-center justify-center rounded-full bg-brand px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          ) : null}

          {phase === "dob" ? (
            <div className="mx-auto mt-12 flex max-w-md justify-center">
              <button
                type="button"
                disabled={!canNext}
                onClick={goNext}
                className="inline-flex min-w-[12rem] items-center justify-center rounded-full bg-brand px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
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
