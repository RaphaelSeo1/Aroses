import { redirect } from "next/navigation";
import { OnboardingClient } from "@/components/OnboardingClient";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    redirect("/login?next=/onboarding");
  }

  const needs = await profileNeedsOnboarding(supabase, user.id);
  if (!needs) {
    redirect("/");
  }

  return <OnboardingClient />;
}
