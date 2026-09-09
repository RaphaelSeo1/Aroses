import { isBillingUiEnabled } from "../billing/feature-flag.ts";
import { configuredTourCourseId } from "./bio-1a.ts";

/** Plans & billing (Profile → billing tab). `/dashboard/billing` redirects here. */
export const SUBSCRIPTION_ACCESS_PATH = "/dashboard/profile?tab=billing";

export function afterOnboardingDestination(): string {
  return isBillingUiEnabled() ? SUBSCRIPTION_ACCESS_PATH : "/";
}

export function productTourStartHref(courseId: string | null | undefined): string {
  const id = (courseId ?? "").trim() || configuredTourCourseId();
  return `/explore/${id}?tour=1`;
}

export function productTourFallbackStartHref(): string {
  return "/explore?tour=1";
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
  if (alreadySubscribed) return false;
  return isBillingUiEnabled();
}
