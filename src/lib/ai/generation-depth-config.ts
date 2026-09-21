import type { CourseGenerationDepth } from "@/lib/billing/plans";

/**
 * Internal infrastructure/performance profile. Distinct from customer-facing
 * CourseGenerationDepth. Depth drives content instructions; profile drives
 * token/module budgets. COURSE_BUILD_PROFILE remains a developer/test override
 * for legacy jobs without a snapshotted depth.
 */
export type CourseBuildProfile = "express" | "fast" | "balanced" | "full";

export const COURSE_GENERATION_DEPTHS: CourseGenerationDepth[] = [
  "essential",
  "standard",
  "detailed",
  "comprehensive",
  "maximum",
];

export function parseCourseGenerationDepth(
  raw: unknown
): CourseGenerationDepth | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (COURSE_GENERATION_DEPTHS as string[]).includes(v)
    ? (v as CourseGenerationDepth)
    : null;
}

export function buildProfileForDepth(
  depth: CourseGenerationDepth
): CourseBuildProfile {
  switch (depth) {
    case "essential":
      return "express";
    case "standard":
      return "fast";
    case "detailed":
      return "balanced";
    case "comprehensive":
    case "maximum":
      return "full";
  }
}

export function depthDisplayLabel(depth: CourseGenerationDepth): string {
  switch (depth) {
    case "essential":
      return "Essential";
    case "standard":
      return "Standard";
    case "detailed":
      return "Detailed";
    case "comprehensive":
      return "Comprehensive";
    case "maximum":
      return "Maximum";
  }
}

export function depthTooltip(depth: CourseGenerationDepth): string {
  switch (depth) {
    case "essential":
      return "Focused on the core ideas and key concepts you need to understand.";
    case "standard":
      return "Adds more supporting detail, explanations, and examples.";
    case "detailed":
      return "Deeper explanations, broader coverage, examples, and connections between topics.";
    case "comprehensive":
      return "Extensive explanations, applications, concept connections, and advanced details.";
    case "maximum":
      return "Our deepest course generation with maximum useful source coverage, detail, examples, and synthesis.";
  }
}

/**
 * Depth-specific CONTENT instructions. Universal accuracy / grounding /
 * anti-hallucination rules stay in study-generation.ts; this block is
 * composed alongside them.
 */
export function depthInstructionBlock(depth: CourseGenerationDepth): string {
  switch (depth) {
    case "essential":
      return `COURSE DEPTH — ESSENTIAL (concise and focused, never inaccurate):
- Prioritize core concepts, essential definitions, major mechanisms and processes, key relationships required for understanding, important terminology, and core learning objectives.
- Use shorter explanations, fewer examples, less supplementary enrichment, fewer niche details, and less cross-topic synthesis.
- Practice: core recall, basic understanding, and essential application.
- Source coverage: CORE MATERIAL. Do not omit foundational concepts to save space.
- Do not invent unsupported relationships. Do not pad with filler.`;
    case "standard":
      return `COURSE DEPTH — STANDARD:
- Include everything Essential requires, plus more supporting details, fuller explanations of why things work, some examples/applications, some connections between related topics, more complete mechanism descriptions, more course context, and stronger practice material.
- Practice: recall, understanding, and simple application.
- Source coverage: IMPORTANT MATERIAL. Foundational concepts are never optional.`;
    case "detailed":
      return `COURSE DEPTH — DETAILED:
- Include everything Standard requires, plus deeper explanations, multiple examples when useful, more applications, more mechanistic detail, meaningful connections between topics, common misconceptions when relevant, more subtle educationally useful details, richer conceptual reasoning, and broader source coverage.
- Practice: more questions, application, conceptual reasoning, and connections across concepts.
- Source coverage: BROAD. Do not invent unsupported relationships.`;
    case "comprehensive":
      return `COURSE DEPTH — COMPREHENSIVE:
- Include everything Detailed requires, plus extensive explanations, extensive useful examples/applications, strong connections across concepts, advanced details that improve understanding, meaningful nuance, deep mechanisms, connections between earlier and later topics, relevant edge cases, sophisticated practice, and very broad coverage of educationally important source material.
- Cross-topic connections: identify relationships between concepts taught in different parts of the source when educationally meaningful (e.g. replication errors → DNA damage → checkpoint pathways). Do not force artificial connections.
- Source coverage: VERY BROAD. Do not generate filler simply to make it longer.`;
    case "maximum":
      return `COURSE DEPTH — MAXIMUM:
- Include everything Comprehensive requires, plus maximum useful educational source coverage, the deepest useful explanations, advanced and niche details where relevant, more applications, deeper synthesis, nuanced distinctions, relevant caveats and edge cases, the strongest practice-question coverage, and sophisticated multi-concept reasoning.
- Preserve the maximum educationally useful depth from the source. Maximum does NOT mean "generate the longest possible text." Keep each lesson compact — cover the idea once, then stop.
- Source coverage: MAXIMUM USEFUL COVERAGE within the module/lesson caps. Do not invent unsupported relationships or pad with filler.`;
  }
}

export function depthOutlineCoverageHint(depth: CourseGenerationDepth): string {
  switch (depth) {
    case "essential":
      return "COVERAGE: Map core sections and foundational topics. Closely related chunks may be combined into fewer, richer lessons. Never omit foundational concepts.";
    case "standard":
      return "COVERAGE: Map important sections and supporting topics. Combine closely related material when it keeps lessons coherent.";
    case "detailed":
      return "COVERAGE: Broad mapping of sections, supporting detail, and useful secondary material. Preserve meaningful distinctions.";
    case "comprehensive":
      return "COVERAGE: Very broad mapping of educationally important source material. Use more lessons/modules when distinctions are educationally justified.";
    case "maximum":
      return "COVERAGE: Maximum useful source coverage. Preserve advanced/niche distinctions that improve understanding. Use more lessons/modules when justified — never filler.";
  }
}
