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
import { getBrowserAuthOrigin } from "@/lib/site-url";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import {
  emailMatchesAllowedDomains,
  schoolEmailPolicyUserMessage,
} from "@/lib/school-email-policy";

/**
 * Age + terms consent sentence, assembled from split dictionary keys so each
 * language can order the clause naturally (Korean puts the verb at the end).
 */
function LegalConsentText() {
  const t = useT();
  return (
    <span className="min-w-0">
      {t.auth.legalPrefix}
      <Link
        href="/legal/terms"
        className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
      >
        {t.auth.legalTerms}
      </Link>
      {t.auth.legalJoin}
      <Link
        href="/legal/privacy"
        className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
      >
        {t.auth.legalPrivacy}
      </Link>
      {t.auth.legalSuffix}
    </span>
  );
}

function SignupContent({
  allowedDomains,
  preferredHint,
  hideEmailPassword,
}: {
  allowedDomains: string[];
  preferredHint: string;
  hideEmailPassword: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const safeNext = parseSafeInternalNext(searchParams.get("next"));
  const afterAuthPath = safeNext ?? "/";
  const loginHref = safeNext
    ? `/login?next=${encodeURIComponent(safeNext)}`
    : "/login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!acceptedLegal) {
      setError(t.auth.confirmLegalFirst);
      return;
    }
    if (
      allowedDomains.length > 0 &&
      !emailMatchesAllowedDomains(email, allowedDomains)
    ) {
      setError(schoolEmailPolicyUserMessage(allowedDomains));
      return;
    }
    setLoading(true);

    const origin = getBrowserAuthOrigin() || window.location.origin;
    const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(afterAuthPath)}`;

    const supabase = createClient();
    const { error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: callbackUrl,
      },
    });

    setLoading(false);

    if (signError) {
      setError(signError.message);
      return;
    }

    setMessage(t.auth.checkEmailToConfirm);
    router.refresh();
  }

  return (
    <>
      <AppHeader
        right={<HeaderNavLink href={loginHref}>{t.auth.logIn}</HeaderNavLink>}
      />
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
            {t.auth.createYourAccount}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {tf(t.auth.startStudyingSmarter, { app: APP_NAME })}
          </p>

          {preferredHint ? (
            <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
              {preferredHint}
            </p>
          ) : null}

          <div className="mt-8 space-y-6">
            {hideEmailPassword ? (
              <>
                <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={acceptedLegal}
                    onChange={(e) => setAcceptedLegal(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-brand focus:ring-brand dark:border-zinc-600"
                  />
                  <LegalConsentText />
                </label>
                <GoogleSignInButton
                  nextPath={afterAuthPath}
                  disabled={!acceptedLegal}
                  label={t.auth.signUpWithGoogle}
                />
                {!acceptedLegal ? (
                  <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                    {t.auth.acceptTermsToContinue}
                  </p>
                ) : null}
                {error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                ) : null}
                {message ? (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">
                    {message}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <GoogleSignInButton
                  nextPath={afterAuthPath}
                  label={t.auth.signUpWithGoogle}
                />

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
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={acceptedLegal}
                      onChange={(e) => setAcceptedLegal(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-brand focus:ring-brand dark:border-zinc-600"
                    />
                    <LegalConsentText />
                  </label>

                  {error && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {error}
                    </p>
                  )}
                  {message && (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      {message}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !acceptedLegal}
                    className="flex w-full justify-center rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    {loading ? t.auth.creating : t.auth.signUp}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
        <footer className="mt-10 shrink-0 border-t border-zinc-200/80 pt-8 dark:border-zinc-800">
          <LegalFooterLinks />
        </footer>
      </main>
    </>
  );
}

type Props = {
  allowedDomains: string[];
  preferredHint: string;
  hideEmailPassword: boolean;
};

export function SignupPageClient({
  allowedDomains,
  preferredHint,
  hideEmailPassword,
}: Props) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 text-sm text-zinc-500">
          {t.auth.loading}
        </div>
      }
    >
      <SignupContent
        allowedDomains={allowedDomains}
        preferredHint={preferredHint}
        hideEmailPassword={hideEmailPassword}
      />
    </Suspense>
  );
}
