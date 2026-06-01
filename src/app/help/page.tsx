import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { HelpPageContent } from "@/components/help/HelpPageContent";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { APP_NAME } from "@/lib/brand";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: `How to Use ${APP_NAME}`,
  description: `Complete guide to building courses, learning with Rose, quizzes, spaced repetition, and tutor sessions on ${APP_NAME}.`,
};

export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminHubHref = user ? adminHubHrefForSessionUser(user) : undefined;

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedInServer adminHubHref={adminHubHref} />
          ) : (
            <>
              <HeaderNavLink href="/explore">Explore</HeaderNavLink>
              <HeaderNavLink href="/login">Log in</HeaderNavLink>
            </>
          )
        }
      />
      <main className="flex flex-1 flex-col bg-app-gradient px-4 py-10 pb-16 sm:px-6 sm:py-14 sm:pb-20">
        <div className="mx-auto w-full max-w-6xl">
          <p>
            <Link
              href={user ? "/" : "/intro"}
              className="text-sm font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
            >
              {user ? `← Back to workspace` : `← Back to ${APP_NAME}`}
            </Link>
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            How to use {APP_NAME}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Everything in one place — with UI previews of what you&apos;ll see on
            screen. Video walkthroughs are coming soon; the written guide is kept
            up to date with the app.
          </p>

          <div className="mt-10">
            <HelpPageContent />
          </div>

          <div className="mt-16 border-t border-zinc-200 pt-8 dark:border-zinc-800">
            <LegalFooterLinks />
          </div>
        </div>
      </main>
    </>
  );
}
