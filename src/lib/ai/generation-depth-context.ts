import { AsyncLocalStorage } from "node:async_hooks";
import {
  generationDepthForTier,
  parsePlanTier,
  type CourseGenerationDepth,
} from "@/lib/billing/plans";

const depthContext = new AsyncLocalStorage<CourseGenerationDepth>();

/** Snapshot the authorized generation depth for this job's async work. */
export function enterGenerationDepthContext(depth: CourseGenerationDepth): void {
  try {
    depthContext.enterWith(depth);
  } catch {
    // Never let context setup break generation.
  }
}

export function getGenerationDepthContext(): CourseGenerationDepth | null {
  return depthContext.getStore() ?? null;
}

export function enterGenerationDepthFromJob(opts: {
  generationDepth: CourseGenerationDepth | null;
  billingTierSnapshot?: string | null;
}): void {
  if (opts.generationDepth) {
    enterGenerationDepthContext(opts.generationDepth);
    return;
  }
  const tier = parsePlanTier(opts.billingTierSnapshot);
  if (tier) enterGenerationDepthContext(generationDepthForTier(tier));
}
