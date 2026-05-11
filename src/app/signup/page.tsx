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
import { parseSafeInternalNext } from "@/lib/internal-next-path";
import { getPublicSiteOrigin } from "@/lib/site-url";

function SignupContent() {
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
      setError(
        "Please confirm your age and accept the Terms and Privacy Policy."
      );
      return;
    }
    setLoading(true);

    const origin = getPublicSiteOrigin() || window.location.origin;
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

    setMessage(
      "Check your email to confirm your account, or log in if confirmation is disabled."
    );
    router.refresh();
  }

  return (
    <>
      <AppHeader
        right={<HeaderNavLink href={loginHref}>Log in</HeaderNavLink>}
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
            Create your account
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Start studying smarter with {APP_NAME}.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
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
                Password
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
              <span className="min-w-0">
                I am at least{" "}
                <strong className="font-semibold">13 years old</strong> and I
                agree to the{" "}
                <Link
                  href="/legal/terms"
                  className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="/legal/privacy"
                  className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
                >
                  Privacy Policy
                </Link>
                .
              </span>
            </label>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
              {loading ? "Creating…" : "Sign up"}
            </button>
          </form>
        </div>
        <footer className="mt-10 shrink-0 border-t border-zinc-200/80 pt-8 dark:border-zinc-800">
          <LegalFooterLinks />
        </footer>
      </main>
    </>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 text-sm text-zinc-500">
          Loading…
        </div>
      }
    >
      <SignupContent />
    </Suspense>
  );
}
