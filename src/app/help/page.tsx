import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { HelpPageContent } from "@/components/help/HelpPageContent";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { APP_NAME } from "@/lib/brand";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import { tf } from "@/lib/i18n/format";
import { getT, getUiLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/locales";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getUiLocale();
  const t = getDictionary(locale).help;
  return {
    title: tf(t.metaTitle, { app: APP_NAME }),
    description: tf(t.metaDescription, { app: APP_NAME }),
  };
}

export default async function HelpPage() {
  const t = await getT();
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
              <HeaderNavLink href="/explore">{t.nav.explore}</HeaderNavLink>
              <HeaderNavLink href="/login">{t.nav.login}</HeaderNavLink>
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
              {user
                ? t.help.backToWorkspace
                : tf(t.help.backToApp, { app: APP_NAME })}
            </Link>
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            {tf(t.help.title, { app: APP_NAME })}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t.help.subtitle}
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
