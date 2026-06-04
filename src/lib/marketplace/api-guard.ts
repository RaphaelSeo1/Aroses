import { NextResponse } from "next/server";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";

export function marketplaceApiUnavailable(): NextResponse | null {
  if (!isMarketplaceUiEnabled()) {
    return NextResponse.json(
      { error: "Marketplace is not available yet." },
      { status: 404 }
    );
  }
  return null;
}
