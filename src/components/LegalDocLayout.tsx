import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";

export async function LegalDocLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedIn />
          ) : (
            <>
              <HeaderNavLink href="/explore">Explore</HeaderNavLink>
              <HeaderNavLink href="/login">Log in</HeaderNavLink>
            </>
          )
        }
      />
      <main className="flex flex-1 flex-col bg-app-gradient px-4 py-10 pb-16 sm:px-6 sm:py-14 sm:pb-20">
        <article className="mx-auto flex w-full max-w-3xl flex-col">
          <p className="rounded-xl border border-amber-200/90 bg-amber-50 px-4 py-3.5 text-sm leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100">
            This page is a <strong>starting template</strong>, not legal advice.
            Have a qualified attorney review it for your jurisdiction before you
            rely on it.
          </p>
          <p className="mt-6">
            <Link
              href="/"
              className="text-sm font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
            >
              ← Back to {APP_NAME}
            </Link>
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {title}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Last updated: May 10, 2026
          </p>
          <div className="mt-8 flex flex-col gap-7 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 [&_h2]:scroll-mt-28 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-zinc-900 [&_h2]:dark:text-zinc-50 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-zinc-900 [&_h3]:dark:text-zinc-100 [&_ul]:list-disc [&_ul]:space-y-2.5 [&_ul]:pl-5 [&_ul]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-zinc-900 [&_strong]:dark:text-zinc-100 [&_a]:font-medium [&_a]:text-brand [&_a]:underline-offset-2 [&_a]:hover:underline dark:[&_a]:text-brand-soft [&_code]:rounded-md [&_code]:bg-zinc-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.8125rem] dark:[&_code]:bg-zinc-800">
            {children}
          </div>
          <div className="mt-14 border-t border-zinc-200 pt-8 dark:border-zinc-800">
            <LegalFooterLinks />
          </div>
        </article>
      </main>
    </>
  );
}
