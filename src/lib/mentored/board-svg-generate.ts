import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_HAIKU } from "@/lib/ai/anthropic-models";
import {
  boardScenePrompt,
  constrainScene,
  fallbackScene,
  parseSceneSpec,
  renderBoardScene,
  type BoardSceneSpec,
} from "@/lib/mentored/board-scene-spec";

const cache = new Map<string, string>();
const CACHE_MAX = 24;

const SCENE_TOOL = {
  name: "submit_scene",
  description: "Submit the short teaching scene. Do not include coordinates.",
  input_schema: {
    type: "object" as const,
    properties: {
      layout: {
        type: "string",
        enum: ["flow", "graph", "cycle", "steps", "stage"],
      },
      motion: {
        type: "string",
        enum: ["flow", "slide", "press", "cycle", "steps", "hold"],
      },
      parts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            kind: {
              type: "string",
              enum: ["node", "end", "card", "aside", "note", "demand", "supply", "marker", "station"],
            },
            tone: { type: "string", enum: ["rose", "gold", "blue", "white"] },
          },
          required: ["label"],
        },
      },
      steps: { type: "array", items: { type: "string" } },
    },
    required: ["layout", "motion"],
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
 * Haiku names the objects, the exact labels, and the motion.
 * The app draws and animates that scene.
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

  let spec: BoardSceneSpec;
  try {
    const parsed = await requestScene(input);
    spec = parsed ? constrainScene(parsed, input.labels) : fallbackScene(input);
  } catch {
    spec = fallbackScene(input);
  }
  const svg = renderBoardScene(spec);
  cacheSet(key, svg);
  return svg;
}

async function requestScene(input: {
  title: string;
  brief: string;
  labels: string[];
  motion?: string;
}): Promise<BoardSceneSpec | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fallbackScene(input);

  const user = boardScenePrompt(input);

  const anthropic = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_HAIKU,
    max_tokens: 700,
    temperature: 0,
    tools: [SCENE_TOOL],
    tool_choice: { type: "tool", name: SCENE_TOOL.name },
    messages: [{ role: "user", content: user }],
  });
  const tool = msg.content.find((part) => part.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;
  return parseSceneSpec(tool.input);
}
