/**
 * Master switch for marketplace / paid course UI across the site.
 *
 * Set `MARKETPLACE_UI_ENABLED` to `true` when you want Explore for-sale
 * listings, seller payouts, checkout, and listing management visible again.
 * Webhooks, Supabase tables, and purchase entitlements stay in place — only
 * student-facing and seller-facing surfaces are hidden.
 */

export const MARKETPLACE_UI_ENABLED = true;

export function isMarketplaceUiEnabled(): boolean {
  return MARKETPLACE_UI_ENABLED;
}
