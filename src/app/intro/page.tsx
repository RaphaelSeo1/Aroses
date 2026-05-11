import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { MarketingLandingContent } from "@/components/MarketingLandingContent";
import { createClient } from "@/lib/supabase/server";

export default async function IntroPage() {
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
