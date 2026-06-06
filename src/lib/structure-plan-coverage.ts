import type {
  CourseStructurePlan,
  CourseStructurePlanLesson,
  CourseStructurePlanModule,
} from "@/lib/ai/course-payload";
import type { IngestChunkSummary } from "@/lib/study-ingest/chunking";

type CourseBuildProfile = "express" | "fast" | "balanced" | "full";

export type StructurePlanTargets = {
  chunkCount: number;
  minLessons: number;
  minModules: number;
  maxModules: number;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Depth vs speed knobs derived from chunk count and build profile. */
export function structurePlanTargets(
  chunkCount: number,
  profile: CourseBuildProfile
): StructurePlanTargets {
  if (chunkCount <= 0) {
    return { chunkCount: 0, minLessons: 1, minModules: 1, maxModules: 2 };
  }

  let minLessons: number;
  let maxModules: number;

  if (profile === "express") {
    // ~1 lesson per 2 source chunks; never collapse a multi-section deck to 1 lesson.
    minLessons =
      chunkCount <= 2
        ? 1
        : clampInt(Math.ceil(chunkCount / 2), 2, 14);
    maxModules = 4;
  } else if (profile === "fast") {
    minLessons = clampInt(Math.ceil(chunkCount / 1.75), 2, 18);
    maxModules = 5;
  } else if (profile === "balanced") {
    minLessons = clampInt(Math.ceil(chunkCount / 1.5), 2, 22);
    maxModules = 6;
  } else {
    minLessons = clampInt(Math.ceil(chunkCount / 1.25), 2, 28);
    maxModules = 8;
  }

  const minModules =
    minLessons >= 5 ? 2 : minLessons >= 3 ? 2 : 1;

  return { chunkCount, minLessons, minModules, maxModules };
}

export function collectPlanChunkIds(plan: CourseStructurePlan): Set<string> {
  const ids = new Set<string>();
  for (const mod of plan.modules) {
    for (const lesson of mod.lessons) {
      for (const id of lesson.source_chunk_ids) ids.add(id);
    }
  }
  return ids;
}

export function countPlanLessons(plan: CourseStructurePlan): number {
  return plan.modules.reduce((n, m) => n + m.lessons.length, 0);
}

/**
 * Returns a human-readable error when the plan is too shallow or leaves chunks
 * unassigned. Used to trigger a replan (cheap) before module writing (expensive).
 */
export function validateStructurePlanCoverage(
  plan: CourseStructurePlan,
  chunkSummaries: IngestChunkSummary[],
  targets: StructurePlanTargets
): string | null {
  const expected = new Set(chunkSummaries.map((c) => c.id));
  const referenced = collectPlanChunkIds(plan);
  const lessonCount = countPlanLessons(plan);
  const moduleCount = plan.modules.length;

  const missing: string[] = [];
  for (const id of expected) {
    if (!referenced.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    return `${missing.length} content chunk(s) are not assigned to any lesson (e.g. ${missing.slice(0, 4).join(", ")}). Every chunk must appear in exactly one lesson's source_chunk_ids.`;
  }

  const unknown: string[] = [];
  for (const id of referenced) {
    if (!expected.has(id)) unknown.push(id);
  }
  if (unknown.length > 0) {
    return `Plan references unknown chunk ids: ${unknown.slice(0, 4).join(", ")}.`;
  }

  if (
    targets.chunkCount >= 3 &&
    lessonCount < targets.minLessons
  ) {
    return `Only ${lessonCount} lesson(s) for ${targets.chunkCount} source chunks; need at least ${targets.minLessons} lessons so major sections are not merged away.`;
  }

  if (moduleCount < targets.minModules) {
    return `Only ${moduleCount} module(s); need at least ${targets.minModules} for this deck size.`;
  }

  if (moduleCount > targets.maxModules) {
    return `${moduleCount} modules exceeds max ${targets.maxModules} for this profile — merge related modules while keeping all chunk assignments.`;
  }

  // One lesson must not absorb the whole deck when there are many distinct chunks.
  if (targets.chunkCount >= 6 && lessonCount <= 1) {
    return "Entire deck collapsed into a single lesson; split into multiple lessons aligned with chunk sections.";
  }

  return null;
}

export function structurePlanCoveragePromptBlock(
  targets: StructurePlanTargets
): string {
  return `COVERAGE (critical — course quality):
- You have ${targets.chunkCount} content chunk(s). **Every chunk id MUST appear in exactly one lesson's source_chunk_ids.** No orphan chunks.
- Plan **at least ${targets.minLessons} lesson(s)** and **at least ${targets.minModules} module(s)** (at most ${targets.maxModules} modules).
- Map chunks in source order; each lesson should cover a coherent slice of the deck.
- Do NOT collapse unrelated major topics into one lesson (e.g. homonuclear vs heteronuclear vs conjugation should be separate lessons when they appear as separate chunks).
- Supplementary chunks (short examples) may attach to the nearest related lesson — but never drop teaching chunks.
- The later writing step will teach **only** what you assign here; missing chunks = missing course content.`;
}

function lessonTitleFromChunks(chunks: IngestChunkSummary[]): string {
  if (chunks.length === 1) {
    const t = chunks[0]!.title.trim();
    return t.length > 0 ? t : "Core concepts";
  }
  const first = chunks[0]!.title.trim();
  if (first.length > 0) return first;
  return `Sections ${chunks[0]!.position}–${chunks[chunks.length - 1]!.position}`;
}

/**
 * Zero extra model calls: slice chunks into lessons/modules when the model plan
 * is too shallow. Guarantees full chunk coverage for module expansion.
 */
export function buildDeterministicStructurePlan(
  chunkSummaries: IngestChunkSummary[],
  profile: CourseBuildProfile
): CourseStructurePlan {
  const targets = structurePlanTargets(chunkSummaries.length, profile);
  const lessons: CourseStructurePlanLesson[] = [];

  if (chunkSummaries.length === 0) {
    return {
      title: "Course",
      description: "A course built from your uploaded materials.",
      modules: [
        {
          title: "Overview",
          summary: "",
          lessons: [
            { title: "Overview", summary: "", source_chunk_ids: [] },
          ],
        },
      ],
    };
  }

  const chunksPerLesson = Math.max(
    1,
    Math.ceil(chunkSummaries.length / targets.minLessons)
  );

  for (let i = 0; i < chunkSummaries.length; i += chunksPerLesson) {
    const group = chunkSummaries.slice(i, i + chunksPerLesson);
    lessons.push({
      title: lessonTitleFromChunks(group),
      summary: "",
      source_chunk_ids: group.map((c) => c.id),
    });
  }

  const lessonsPerModule =
    profile === "express" ? 2 : profile === "fast" ? 3 : 4;
  const modules: CourseStructurePlanModule[] = [];
  for (let i = 0; i < lessons.length; i += lessonsPerModule) {
    const group = lessons.slice(i, i + lessonsPerModule);
    modules.push({
      title: group[0]!.title,
      summary: "",
      lessons: group,
    });
  }

  const firstTitle = chunkSummaries[0]!.title.trim();
  return {
    title: firstTitle.length > 0 ? firstTitle.slice(0, 60) : "Course",
    description: "A structured course from your uploaded materials.",
    modules,
  };
}
