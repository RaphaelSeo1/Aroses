import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_SONNET } from "@/lib/ai/anthropic-models";
import { renderBoardScene, templatedScene } from "@/lib/mentored/board-scene-spec";
import {
  boardSvgPrompt,
  sanitizeBoardSvg,
  teachingSvgProblems,
  withoutProseLabels,
} from "@/lib/mentored/board-svg";

const cache = new Map<string, string>();
const CACHE_MAX = 24;

const SCENE_TOOL = {
  name: "submit_svg",
  description: "Submit one teaching SVG. The picture is the objects, not a caption.",
  input_schema: {
    type: "object" as const,
    properties: {
      svg: {
        type: "string",
        description: "One svg document, viewBox 0 0 960 540, with the objects drawn.",
      },
    },
    required: ["svg"],
  },
};

function cacheSet(key: string, value: string) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/**
 * A known diagram (atoms, a synthase membrane, a supply curve) is drawn here.
 * Every other idea is drawn from the description, and rejected if it is only words.
 */
export async function generateBoardSvg(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): Promise<string> {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit) return hit;

  const templated = templatedScene(input);
  const svg = templated
    ? renderBoardScene(templated)
    : await drawDescribedSvg(input);
  cacheSet(key, svg);
  return svg;
}

async function drawDescribedSvg(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): Promise<string> {
  let problems: string[] = [];
  let last = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw = "";
    try {
      raw = await requestSvg({ ...input, problems });
    } catch (error) {
      problems = [error instanceof Error ? error.message : "the drawing request failed"];
      continue;
    }
    const svg = raw ? sanitizeBoardSvg(raw) : null;
    if (!svg) {
      problems = ["the reply was not an svg drawing"];
      continue;
    }
    const cleaned = withoutProseLabels(svg);
    last = cleaned;
    problems = teachingSvgProblems(cleaned, input);
    if (problems.length === 0) return cleaned;
  }
  const error = new Error(
    problems.length > 0 ? problems.join("; ") : "Could not draw the board."
  );
  if (last) (error as Error & { svg?: string }).svg = last;
  throw error;
}

async function requestSvg(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
  problems?: string[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_SONNET,
    max_tokens: 8000,
    temperature: 0.2,
    tools: [SCENE_TOOL],
    tool_choice: { type: "tool", name: SCENE_TOOL.name },
    messages: [{ role: "user", content: boardSvgPrompt(input) }],
  });
  const tool = msg.content.find((part) => part.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return "";
  const payload = tool.input as { svg?: unknown };
  return typeof payload.svg === "string" ? payload.svg : "";
}
