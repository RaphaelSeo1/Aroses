import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { MarketingLandingContent } from "@/components/MarketingLandingContent";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function IntroPage() {
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
              <LanguageSwitcher />
              <HeaderNavLink href="/explore">{t.nav.explore}</HeaderNavLink>
              <HeaderNavLink href="/login">{t.nav.login}</HeaderNavLink>
              <HeaderNavLink href="/signup" variant="primary">
                {t.nav.signup}
              </HeaderNavLink>
            </>
          )
        }
      />
      <MarketingLandingContent isAuthenticated={Boolean(user)} />
    </>
  );
}
