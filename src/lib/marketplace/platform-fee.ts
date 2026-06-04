import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";

/** Platform take on marketplace sales (percent of list price). Default 15%. */
export function marketplacePlatformFeePercent(): number {
  const raw = process.env.MARKETPLACE_PLATFORM_FEE_PERCENT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 15;
  if (!Number.isFinite(n) || n < 0 || n > 50) return 15;
  return n;
}

export function computePlatformFeeCents(priceCents: number): number {
  const pct = marketplacePlatformFeePercent();
  return Math.min(
    priceCents,
    Math.max(0, Math.round((priceCents * pct) / 100))
  );
}

export function isMarketplacePaymentsEnabled(): boolean {
  return (
    isMarketplaceUiEnabled() &&
    Boolean(process.env.STRIPE_SECRET_KEY?.trim())
  );
}
