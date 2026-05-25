import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { MarketingLandingContent } from "@/components/MarketingLandingContent";
import { adminHubHrefForSessionUser } from "@/lib/app-admin-env";
import { createClient } from "@/lib/supabase/server";

export default async function IntroPage() {
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
              <HeaderNavLink href="/signup" variant="primary">
                Sign up
              </HeaderNavLink>
            </>
          )
        }
      />
      <MarketingLandingContent isAuthenticated={Boolean(user)} />
    </>
  );
}
