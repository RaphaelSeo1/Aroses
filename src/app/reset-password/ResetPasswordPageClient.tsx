"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BrandLogo } from "@/components/BrandLogo";
import { useT } from "@/lib/i18n/LocaleProvider";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME } from "@/lib/brand";

export function ResetPasswordPageClient() {
  const t = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        if (!data.session) {
          router.replace("/login?next=/reset-password");
        } else {
          setCheckingSession(false);
        }
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t.auth.passwordMin8);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.auth.passwordsMismatch);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace("/dashboard/profile?tab=account");
    router.refresh();
  }

  if (checkingSession) {
    return (
      <>
        <AppHeader />
        <div className="mx-auto flex max-w-md flex-1 flex-col justify-center px-4 py-24 text-center text-sm text-zinc-500">
          {t.auth.loading}
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-1 flex-col px-4 py-10 pb-12 sm:py-12">
        <div className="flex flex-1 flex-col justify-center py-4">
          <Link
            href="/"
            className="mb-7 inline-flex w-fit"
            aria-label={`${APP_NAME} home`}
          >
            <BrandLogo className="h-14 w-14 sm:h-16 sm:w-16" />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.auth.resetTitle}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t.auth.resetBody}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t.auth.newPassword}
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t.auth.confirmPassword}
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="text-sm text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {loading ? t.common.saving : t.auth.updatePassword}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
