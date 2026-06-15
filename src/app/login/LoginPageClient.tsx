"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { BrandLogo } from "@/components/BrandLogo";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { APP_NAME } from "@/lib/brand";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { parseSafeInternalNext } from "@/lib/internal-next-path";
import { reportClientActivity } from "@/lib/activity-log-client";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import {
  emailMatchesAllowedDomains,
  schoolEmailPolicyUserMessage,
} from "@/lib/school-email-policy";

function LoginForm({
  nextPath,
  authError,
  allowedDomains,
  preferredHint,
  hideEmailPassword,
}: {
  nextPath: string;
  authError: string | null;
  allowedDomains: string[];
  preferredHint: string;
  hideEmailPassword: boolean;
}) {
  const t = useT();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (
      allowedDomains.length > 0 &&
      !emailMatchesAllowedDomains(email, allowedDomains)
    ) {
      setError(schoolEmailPolicyUserMessage(allowedDomains));
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: signError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    void reportClientActivity("sign_in");
    router.replace(nextPath);
    router.refresh();
  }

  return (
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
          {t.auth.logIn}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {tf(t.auth.welcomeBack, { app: APP_NAME })}
        </p>

        {preferredHint ? (
          <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
            {preferredHint}
          </p>
        ) : null}

        {authError === "school_email" ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100"
          >
            {t.auth.notApproved}{" "}
            {allowedDomains.length > 0
              ? schoolEmailPolicyUserMessage(allowedDomains)
              : t.auth.signInWithAllowedEmail}
          </p>
        ) : null}

        <div className="mt-8 space-y-6">
          <GoogleSignInButton nextPath={nextPath} />

          {!hideEmailPassword ? (
            <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t.auth.orEmail}
                </span>
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              </div>

              <form onSubmit={onSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    {t.auth.email}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    {t.auth.password}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full justify-center rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {loading ? t.auth.signingIn : t.auth.logIn}
                </button>
              </form>
            </>
          ) : (
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              {t.auth.emailPasswordDisabled}
            </p>
          )}
        </div>
      </div>
      <footer className="mt-10 shrink-0 border-t border-zinc-200/80 pt-8 dark:border-zinc-800">
        <LegalFooterLinks />
      </footer>
    </main>
  );
}

function LoginPageInner({
  allowedDomains,
  preferredHint,
  hideEmailPassword,
}: {
  allowedDomains: string[];
  preferredHint: string;
  hideEmailPassword: boolean;
}) {
  const t = useT();
  const searchParams = useSearchParams();
  const safeNext = parseSafeInternalNext(searchParams.get("next"));
  const nextPath = safeNext ?? "/";
  const signupHref = safeNext
    ? `/signup?next=${encodeURIComponent(safeNext)}`
    : "/signup";

  return (
    <>
      <AppHeader
        right={
          <HeaderNavLink href={signupHref} variant="primary">
            {t.auth.signUp}
          </HeaderNavLink>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <LoginForm
          nextPath={nextPath}
          authError={searchParams.get("auth_error")}
          allowedDomains={allowedDomains}
          preferredHint={preferredHint}
          hideEmailPassword={hideEmailPassword}
        />
      </div>
    </>
  );
}

type Props = {
  allowedDomains: string[];
  preferredHint: string;
  hideEmailPassword: boolean;
};

export function LoginPageClient({
  allowedDomains,
  preferredHint,
  hideEmailPassword,
}: Props) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
          <AppHeader />
          <div className="mx-auto flex max-w-md flex-1 flex-col justify-center px-4 py-24 text-center text-sm text-zinc-500">
            {t.auth.loading}
          </div>
        </div>
      }
    >
      <LoginPageInner
        allowedDomains={allowedDomains}
        preferredHint={preferredHint}
        hideEmailPassword={hideEmailPassword}
      />
    </Suspense>
  );
}
