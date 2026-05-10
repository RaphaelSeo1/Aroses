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

function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
          Log in
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Welcome back to {APP_NAME}.
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
      <footer className="mt-10 shrink-0 border-t border-zinc-200/80 pt-8 dark:border-zinc-800">
        <LegalFooterLinks />
      </footer>
    </main>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const safeNext = parseSafeInternalNext(searchParams.get("next"));
  const nextPath = safeNext ?? "/dashboard";
  const signupHref = safeNext
    ? `/signup?next=${encodeURIComponent(safeNext)}`
    : "/signup";

  return (
    <>
      <AppHeader
        right={
          <HeaderNavLink href={signupHref} variant="primary">
            Sign up
          </HeaderNavLink>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <LoginForm nextPath={nextPath} />
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
          <AppHeader />
          <div className="mx-auto flex max-w-md flex-1 flex-col justify-center px-4 py-24 text-center text-sm text-zinc-500">
            Loading…
          </div>
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
