import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/billing/ai-usage";

/**
 * Extract on-screen lecture content from a single JPEG frame.
 * Reuses PDF table-vision fidelity conventions (GFM tables, verbatim numbers).
 */

const MODEL =
  process.env.LIVE_NOTES_VISION_MODEL?.trim() ||
  process.env.PDF_INGEST_VISION_MODEL?.trim() ||
  process.env.ANTHROPIC_FAST_MODEL?.trim() ||
  "claude-haiku-4-5";

const SCREEN_PROMPT = `Analyze this single frame from a live lecture screen share (slides, whiteboard, or document).

Return ONLY valid JSON (no markdown fences):
{
  "title": string | null,
  "bodyText": string,
  "equations": string[],
  "tableText": string | null,
  "diagrams": string[],
  "isArosesUi": boolean
}

Rules:
- title: main slide/heading title if clearly visible, else null.
- bodyText: all readable on-screen prose, bullet points, and labels. Preserve spellings, symbols, drug/chemical names, and numbers exactly. Use newlines between blocks.
- equations: each equation or formula as plain text / simple LaTeX-ish (e.g. "E = mc^2", "AUC_0-∞"). Empty array if none.
- tableText: if ANY data table/grid is visible, output GitHub-flavored markdown (header + |---| + one row per source row). Multiple tables → separate with a blank line. Preserve every number, range (en-dash), and name exactly. null only when there is truly no tabular grid.
- diagrams: short descriptions of non-table illustrations (anatomy, flowcharts, structures). Do NOT invent numbers that are not readable. Empty array if none.
- isArosesUi: true ONLY if this frame is clearly the Rose / Aroses Live Notes app itself (our notes editor, "Live notes" chrome, or our workspace) — infinity-mirror case. False for normal lecture slides/apps.

If the frame is blank, mostly black, or unreadable, return empty bodyText and null title/tableText.`;

export type ScreenVisionExtract = {
  title: string | null;
  bodyText: string;
  equations: string[];
  tableText: string | null;
  diagrams: string[];
  isArosesUi: boolean;
  /** Flattened text for synthesis / wrap-up. */
  flatText: string;
};

export async function extractScreenContent(input: {
  jpegBase64: string;
  mediaType?: "image/jpeg" | "image/png" | "image/webp";
  userId?: string;
}): Promise<ScreenVisionExtract | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2_000,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType ?? "image/jpeg",
                data: input.jpegBase64,
              },
            },
            { type: "text", text: SCREEN_PROMPT },
          ],
        },
      ],
    });

    recordAiUsage({
      model: MODEL,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
      feature: "live-notes-screen",
      userId: input.userId ?? null,
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseScreenVisionJson(textBlock.text);
  } catch {
    return null;
  }
}

function parseScreenVisionJson(raw: string): ScreenVisionExtract | null {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as {
      title?: unknown;
      bodyText?: unknown;
      equations?: unknown;
      tableText?: unknown;
      diagrams?: unknown;
      isArosesUi?: unknown;
    };

    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 300)
        : null;
    const bodyText =
      typeof parsed.bodyText === "string" ? parsed.bodyText.trim().slice(0, 8_000) : "";
    const equations = Array.isArray(parsed.equations)
      ? parsed.equations
          .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
          .map((e) => e.trim().slice(0, 400))
          .slice(0, 20)
      : [];
    let tableText: string | null = null;
    if (typeof parsed.tableText === "string") {
      const t = parsed.tableText.trim();
      if (t && t.toLowerCase() !== "null" && t.includes("|") && t.length >= 12) {
        tableText = t.slice(0, 12_000);
      }
    }
    const diagrams = Array.isArray(parsed.diagrams)
      ? parsed.diagrams
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.trim().slice(0, 500))
          .slice(0, 8)
      : [];
    const isArosesUi = parsed.isArosesUi === true;

    const parts: string[] = [];
    if (title) parts.push(`## ${title}`);
    if (bodyText) parts.push(bodyText);
    if (equations.length) {
      parts.push("Equations:\n" + equations.map((e) => `- ${e}`).join("\n"));
    }
    if (tableText) parts.push(tableText);
    if (diagrams.length) {
      parts.push(
        "Diagrams:\n" + diagrams.map((d) => `- ${d}`).join("\n")
      );
    }

    return {
      title,
      bodyText,
      equations,
      tableText,
      diagrams,
      isArosesUi,
      flatText: parts.join("\n\n").trim(),
    };
  } catch {
    return null;
  }
}

/** Format stored screen rows for synthesize / wrap-up prompts. */
export function formatScreenContextForPrompt(
  slices: Array<{ atMs: number; title?: string | null; text: string }>,
  maxChars = 4_000
): string {
  if (slices.length === 0) return "";
  const blocks = slices.map((s) => {
    const m = Math.floor(s.atMs / 60_000);
    const sec = Math.floor((s.atMs % 60_000) / 1000);
    const stamp = `${m}:${String(sec).padStart(2, "0")}`;
    const head = s.title ? `[${stamp}] ${s.title}` : `[${stamp}]`;
    return `${head}\n${s.text.trim()}`;
  });
  let out = blocks.join("\n\n");
  if (out.length > maxChars) out = out.slice(-maxChars);
  return out;
}
