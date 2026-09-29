import type Anthropic from "@anthropic-ai/sdk";
import type { FigureKind, Ranked } from "./figures.ts";
import { meteredClaudeCall, type MeteredCallContext, type MeteredCallDeps } from "./metered-call.ts";

export const REVIEW_TOOL: Anthropic.Tool = {
  name: "review_figures",
  description: "Report which crops are real teaching visuals.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      figures: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer" },
            keep: { type: "boolean" },
            kind: { type: "string", enum: ["diagram", "chart", "image", "table"] },
            description: { type: "string" },
          },
          required: ["n", "keep", "kind", "description"],
          additionalProperties: false,
        },
      },
    },
    required: ["figures"],
    additionalProperties: false,
  },
};

const REVIEW_RULES = `The images are contact sheets of crops from a student's lecture file; each numbered cell is one crop. Decide for every number whether that crop belongs in a study course.
keep=true only for a complete, legible teaching visual: a diagram, chart or graph, labeled figure, micrograph, photo of the subject being taught, or an image of a table.
keep=false for logos, icons, decorations, page headers or footers, slide backgrounds, blank or nearly blank crops, crops cut off mid-figure, crops that are mostly plain text, screenshots of documents or articles, and asides such as memes, cartoons, TV or news screenshots and portraits.
kind=table only for a grid of records: a header row naming the columns and several rows that each fill those same columns. Labels on a diagram, a chart's axis or legend text, captions, page headers or footers, a form, and text laid out in columns are not tables; a labeled drawing is a diagram and a plot is a chart. This holds for every subject and language.
kind: diagram, chart, image or table. description: what it shows in at most 8 words, only what is clearly visible; empty when keep=false.`;

/** Cells per contact sheet (4 × 3 at 256 px keeps a sheet near 1,000 image tokens). */
export const SHEET_CELLS = 12;

/** Tiles images into one numbered contact sheet (JPEG). Numbers start at `first`. */
export type SheetMaker = (images: Buffer[], first: number) => Promise<Buffer>;

export type ReviewVerdict = { keep: boolean; kind: FigureKind; description: string };

const KINDS: ReadonlySet<string> = new Set(["diagram", "chart", "image", "table"]);

export function parseReview(input: unknown, count: number): Array<ReviewVerdict | null> {
  const out: Array<ReviewVerdict | null> = Array.from({ length: count }, () => null);
  const list = (input as { figures?: unknown })?.figures;
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const i = Number(r.n) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= count || out[i]) continue;
    const kind = typeof r.kind === "string" && KINDS.has(r.kind) ? (r.kind as FigureKind) : "diagram";
    const description = typeof r.description === "string" ? r.description.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    out[i] = { keep: r.keep === true, kind, description };
  }
  return out;
}

function jpegBlock(data: Buffer): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } };
}

/**
 * One low-resolution vision call for every candidate: contact sheets when a
 * sheet maker is available, otherwise one thumbnail per crop. A missing
 * verdict means "drop".
 */
export async function reviewFigures(
  metered: MeteredCallDeps,
  ctx: MeteredCallContext,
  items: Ranked[],
  opts: { signal?: AbortSignal; makeSheet?: SheetMaker } = {}
): Promise<{ verdicts: Array<ReviewVerdict | null>; costUsd: number }> {
  if (items.length === 0) return { verdicts: [], costUsd: 0 };
  const content: Anthropic.ContentBlockParam[] = [];
  if (opts.makeSheet) {
    for (let i = 0; i < items.length; i += SHEET_CELLS) {
      const chunk = items.slice(i, i + SHEET_CELLS);
      content.push({ type: "text", text: `Cells ${i + 1}–${i + chunk.length}:` });
      content.push(jpegBlock(await opts.makeSheet(chunk.map((r) => r.candidate.thumb), i + 1)));
    }
  } else {
    items.forEach((r, i) => {
      content.push({ type: "text", text: `${i + 1}.` });
      content.push(jpegBlock(r.candidate.thumb));
    });
  }
  const captions = items.map((r, i) => (r.label ? `${i + 1}: ${r.label}` : "")).filter(Boolean);
  content.push({
    type: "text",
    text: `${captions.length ? `Captions printed next to some crops:\n${captions.join("\n")}\n` : ""}Review all ${items.length} crops.`,
  });
  const { message, costUsd } = await meteredClaudeCall(
    metered,
    ctx,
    {
      max_tokens: 60 + 32 * items.length,
      system: REVIEW_RULES,
      tools: [REVIEW_TOOL],
      tool_choice: { type: "tool", name: REVIEW_TOOL.name },
      messages: [{ role: "user", content }],
    },
    // Modules wait for the figures step, so a slow review gives up early.
    { signal: opts.signal, timeoutMs: 45_000 }
  );
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === REVIEW_TOOL.name
  );
  return { verdicts: parseReview(block?.input, items.length), costUsd };
}
