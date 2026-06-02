import "server-only";
import Stripe from "stripe";
import { getPublicSiteOrigin } from "@/lib/site-url";

/**
 * Server-only Stripe client. The secret key never reaches the browser.
 * Created lazily so importing this module doesn't throw when the key is unset
 * (e.g. during a build without Stripe configured).
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — add it to your environment to enable billing."
    );
  }
  cached = new Stripe(key, { appInfo: { name: "Aroses" } });
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/**
 * Absolute origin for Stripe redirect/return URLs. Prefers the forwarded host
 * (so checkout returns to whatever host the user is on — localhost or prod),
 * falling back to NEXT_PUBLIC_SITE_URL.
 */
export function originFromRequest(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto =
      h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return getPublicSiteOrigin();
}
