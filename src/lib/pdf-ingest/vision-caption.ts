import Anthropic from "@anthropic-ai/sdk";
import { acquireClaudeBudget } from "@/lib/ai/anthropic-rate-limit";

const SONNET = "claude-sonnet-4-6";

export type AssetVisionCaption = {
  type: "table" | "figure" | "image" | "decorative" | "page_snapshot";
  title: string;
  description: string;
  caption: string;
  labels: string[];
  teachingPurpose: string;
  relatedTopics: string[];
  whenToUse: string;
  keep: boolean;
};

const VISION_CAPTION_PROMPT = `You analyze a visual region from a lecture PDF (medicine, pharmacology, science).

Return ONLY valid JSON (no markdown fences):
{
  "type": "table"|"figure"|"image"|"decorative"|"page_snapshot",
  "title": "short title (≤8 words)",
  "description": "2-4 sentences describing what is shown",
  "caption": "one-line label for semantic search",
  "labels": ["key terms visible in the visual"],
  "teachingPurpose": "what concept this visual teaches",
  "relatedTopics": ["topic1","topic2"],
  "whenToUse": "when a tutor should show this during a lesson",
  "keep": true|false
}

Rules:
- table: data grid with rows/columns — set keep:false (tables become course text, not images).
- figure: diagram, flowchart, mechanism, anatomy, chart with axes.
- image: photograph or raster illustration without tabular grid.
- page_snapshot: full slide/page — set keep:false unless a distinct diagram cannot be cropped.
- decorative: logos, headers, footers, page numbers, bullet-text-only regions — set keep:false.
- keep:true only for distinct pedagogical diagrams/illustrations.`;

function parseVisionJson(raw: string): AssetVisionCaption | null {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const type = o.type;
    if (
      type !== "table" &&
      type !== "figure" &&
      type !== "image" &&
      type !== "decorative" &&
      type !== "page_snapshot"
    ) {
      return null;
    }
    const str = (k: string, max: number) => {
      const v = o[k];
      return typeof v === "string" ? v.trim().slice(0, max) : "";
    };
    const labels = Array.isArray(o.labels)
      ? (o.labels as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const relatedTopics = Array.isArray(o.relatedTopics)
      ? (o.relatedTopics as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const keep =
      o.keep !== false &&
      type !== "decorative" &&
      type !== "table" &&
      type !== "page_snapshot";
    return {
      type,
      title: str("title", 80) || str("caption", 80),
      description: str("description", 600),
      caption: str("caption", 240) || str("title", 240),
      labels,
      teachingPurpose: str("teachingPurpose", 300),
      relatedTopics,
      whenToUse: str("whenToUse", 300),
      keep:
        type === "decorative" || type === "table" || type === "page_snapshot"
          ? false
          : keep,
    };
  } catch {
    return null;
  }
}

export function buildSearchableCaptionText(meta: AssetVisionCaption): string {
  return [
    meta.title,
    meta.caption,
    meta.description,
    meta.teachingPurpose,
    meta.whenToUse,
    meta.labels.length ? `Labels: ${meta.labels.join(", ")}` : "",
    meta.relatedTopics.length ? `Topics: ${meta.relatedTopics.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Sonnet vision caption for a cropped or full-page PDF visual.
 */
export async function captionVisualAsset(input: {
  imagePng: Buffer;
  pageNum: number;
  source: string;
  surroundingText?: string;
  isPageSnapshot?: boolean;
  maxAttempts?: number;
}): Promise<AssetVisionCaption> {
  const fallback: AssetVisionCaption = {
    type: input.isPageSnapshot ? "page_snapshot" : "figure",
    title: input.isPageSnapshot
      ? `Page ${input.pageNum}`
      : `Visual page ${input.pageNum}`,
    description: "",
    caption: input.isPageSnapshot
      ? `Full page ${input.pageNum} from upload`
      : `Visual from page ${input.pageNum}`,
    labels: [],
    teachingPurpose: "",
    relatedTopics: [],
    whenToUse: "",
    keep: true,
  };

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !input.imagePng?.length) return fallback;

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });
  const attempts = Math.max(1, input.maxAttempts ?? 3);
  const context = [
    VISION_CAPTION_PROMPT,
    `PAGE: ${input.pageNum}`,
    `EXTRACTION: ${input.source}`,
    input.isPageSnapshot ? "This is a FULL PAGE snapshot fallback." : "",
    input.surroundingText?.trim()
      ? `SURROUNDING TEXT:\n${input.surroundingText.trim().slice(0, 800)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await acquireClaudeBudget({
        estOutputTokens: 512,
        messages: [{ content: context }],
      });

      const msg = await anthropic.messages.create({
        model: SONNET,
        max_tokens: 512,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: input.imagePng.toString("base64"),
                },
              },
              { type: "text", text: context },
            ],
          },
        ],
      });

      const block = msg.content.find((b) => b.type === "text");
      const raw = block?.type === "text" ? block.text : "";
      const parsed = parseVisionJson(raw);
      if (parsed) return parsed;
    } catch (e) {
      console.warn("[captionVisualAsset] attempt", attempt + 1, e);
    }
  }

  return fallback;
}
