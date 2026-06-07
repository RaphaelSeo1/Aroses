import {
  captionVisualAsset,
  type AssetVisionCaption,
} from "@/lib/pdf-ingest/vision-caption";

export type AssetClassifyType = "table" | "figure" | "image" | "decorative";

export type AssetClassifyResult = {
  type: AssetClassifyType;
  caption: string;
  keep: boolean;
  vision?: AssetVisionCaption;
};

function mapVisionType(type: AssetVisionCaption["type"]): AssetClassifyType {
  if (type === "table") return "table";
  if (type === "image") return "image";
  if (type === "decorative") return "decorative";
  return "figure";
}

/**
 * Sonnet adjudicates asset type + rich caption (always Sonnet).
 */
export async function classifyAssetCrop(input: {
  cropPng: Buffer;
  pageNum: number;
  source: string;
  surroundingText?: string;
  maxAttempts?: number;
}): Promise<AssetClassifyResult> {
  const vision = await captionVisualAsset({
    imagePng: input.cropPng,
    pageNum: input.pageNum,
    source: input.source,
    surroundingText: input.surroundingText,
    maxAttempts: input.maxAttempts,
  });

  return {
    type: mapVisionType(vision.type),
    caption: vision.caption || vision.title,
    keep: vision.keep,
    vision,
  };
}

export { captionVisualAsset, buildSearchableCaptionText } from "@/lib/pdf-ingest/vision-caption";
export type { AssetVisionCaption } from "@/lib/pdf-ingest/vision-caption";
