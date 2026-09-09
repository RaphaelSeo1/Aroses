import { isBillingUiEnabled } from "../billing/feature-flag.ts";
import { PAID_ACCESS_REDIRECT } from "../billing/paid-access.ts";

/** Plans & billing (Profile → billing tab). Used when unpaid users leave the tour. */
export const SUBSCRIPTION_ACCESS_PATH = PAID_ACCESS_REDIRECT;

/** After the profile wizard, start the original site tour on Home. */
export function afterOnboardingDestination(): string {
  return "/?tour=1";
}

export function productTourStartHref(courseId?: string | null): string {
  void courseId;
  return "/?tour=1";
}

export function productTourFallbackStartHref(): string {
  return "/?tour=1";
}

export function afterTourSkipDestination(): string {
  return isBillingUiEnabled() ? "/?setupUpgrade=1" : "/";
}

/** Server `/onboarding` sends people who already finished setup home — not back into the wizard. */
export function completedOnboardingRedirectPath(): string {
  return "/";
}

export function shouldForceOnboarding(
  onboardingCompletedAt: string | null | undefined
): boolean {
  return onboardingCompletedAt == null;
}

export function tourCompletionShouldRedirectToSubscription(
  alreadySubscribed: boolean
): boolean {
  void alreadySubscribed;
  return false;
}
