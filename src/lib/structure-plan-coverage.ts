import type {
  CourseStructurePlan,
  CourseStructurePlanLesson,
  CourseStructurePlanModule,
} from "@/lib/ai/course-payload";
import type { IngestChunkSummary } from "@/lib/study-ingest/chunking";
import {
  deriveCourseTitleFromChunkTitles,
  disambiguateModuleTitle,
  isBadIngestTitle,
  moduleTitleFromLessonTitles,
  normalizeIngestDisplayTitle,
  polishLessonTitlesForModule,
  substantiveLessonTitles,
} from "@/lib/study-ingest/normalize-ingest-title";
import { isDenseSectionedPharmacologyDeck } from "@/lib/study-ingest/pdf-section-split";

type CourseBuildProfile = "express" | "fast" | "balanced" | "full";

const DENSE_MAX_LESSONS = 14;
const DENSE_TARGET_LESSONS = 11;
const DENSE_MAX_MODULES = 6;

const PHARM_TOPIC_KEY =
  /^(개요|전신마취(?:제)?|수면제|항뇌전증(?:제)?|마약(?:성)?진통(?:제)?|항파킨슨(?:병)?(?:제)?|파킨슨(?:병)?(?:제)?|알츠하이머(?:병)?(?:치료제)?|항정신(?:병)?(?:제)?|항불안(?:제)?|기분장애(?:치료제)?|중추신경자극(?:제)?)/i;

function pharmacologyTopicKey(title: string): string {
  const n = normalizeIngestDisplayTitle(title);
  const m = n.match(PHARM_TOPIC_KEY);
  return m ? m[1]!.toLowerCase() : n.slice(0, 24).toLowerCase();
}

/** Merge adjacent chunks that share the same major pharmacology topic. */
function groupAdjacentPharmacologyChunks(
  chunks: IngestChunkSummary[]
): IngestChunkSummary[][] {
  const groups: IngestChunkSummary[][] = [];
  for (const c of chunks) {
    const key = pharmacologyTopicKey(c.title);
    const last = groups[groups.length - 1];
    if (last && pharmacologyTopicKey(last[0]!.title) === key) {
      last.push(c);
    } else {
      groups.push([c]);
    }
  }
  return groups;
}

/** Fold lesson groups down to a cap by merging the smallest adjacent pair. */
function capLessonGroups(
  groups: IngestChunkSummary[][],
  maxLessons: number
): IngestChunkSummary[][] {
  let cur = groups.map((g) => [...g]);
  while (cur.length > maxLessons && cur.length > 1) {
    let mergeAt = 0;
    let smallest = Infinity;
    for (let i = 0; i < cur.length - 1; i++) {
      const size =
        cur[i]!.reduce((n, c) => n + c.approxChars, 0) +
        cur[i + 1]!.reduce((n, c) => n + c.approxChars, 0);
      if (size < smallest) {
        smallest = size;
        mergeAt = i;
      }
    }
    const merged = [...cur[mergeAt]!, ...cur[mergeAt + 1]!];
    cur = [...cur.slice(0, mergeAt), merged, ...cur.slice(mergeAt + 2)];
  }
  return cur;
}

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
    minLessons =
      chunkCount <= 2
        ? 1
        : clampInt(Math.ceil(chunkCount / 1.5), 2, 28);
    if (chunkCount >= 60) maxModules = 8;
    else if (chunkCount >= 20) maxModules = 6;
    else if (chunkCount >= 10) maxModules = 6;
    else if (chunkCount >= 5) maxModules = 6;
    else maxModules = 4;
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
    const c = chunks[0]!;
    const t = normalizeIngestDisplayTitle(c.title.trim());
    if (!isBadIngestTitle(t)) return t;
    const pos = c.position.trim();
    const page = pos.match(/\bpage\s+(\d+)/i);
    if (page) return `Page ${page[1]}`;
    const slide = pos.match(/\bslide\s+(\d+)/i);
    if (slide) return `Slide ${slide[1]}`;
    return "Core concepts";
  }
  for (const c of chunks) {
    const t = normalizeIngestDisplayTitle(c.title.trim());
    if (!isBadIngestTitle(t)) return t;
  }
  const first = chunks[0]!;
  const last = chunks[chunks.length - 1]!;
  const firstPage = first.position.match(/\bpage\s+(\d+)/i);
  const lastPage = last.position.match(/\bpage\s+(\d+)/i);
  if (firstPage && lastPage) {
    return firstPage[1] === lastPage[1]
      ? `Page ${firstPage[1]}`
      : `Pages ${firstPage[1]}–${lastPage[1]}`;
  }
  if (first.position.trim() && !/^section\s+\d+$/i.test(first.position.trim())) {
    return `${first.position} – ${last.position}`.slice(0, 80);
  }
  return "Core concepts";
}

const GENERIC_INTRO_CHUNK =
  /^(약리학|서론|목차|introduction|overview|chapter\s+overview)$/i;

/** Fold short generic intro chunks (e.g. "약리학") into the next section lesson. */
function shouldFoldIntroChunk(
  cur: IngestChunkSummary,
  next: IngestChunkSummary | undefined
): boolean {
  if (!next) return false;
  const curTitle = normalizeIngestDisplayTitle(cur.title);
  if (!GENERIC_INTRO_CHUNK.test(curTitle)) return false;
  if (cur.approxChars > 2_400) return false;
  const nextTitle = normalizeIngestDisplayTitle(next.title);
  return nextTitle.length > 0;
}

function lessonTitleForChunkGroup(chunks: IngestChunkSummary[]): string {
  if (chunks.length === 1) {
    return lessonTitleFromChunks(chunks);
  }
  const substantive = substantiveLessonTitles(chunks.map((c) => c.title));
  if (substantive.length > 0) {
    return substantive[0]!;
  }
  return lessonTitleFromChunks(chunks);
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
      description: "",
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

  const denseSectioned = isDenseSectionedPharmacologyDeck(chunkSummaries);

  if (denseSectioned) {
    let groups = groupAdjacentPharmacologyChunks(chunkSummaries);
    if (groups.length > DENSE_MAX_LESSONS) {
      groups = capLessonGroups(groups, DENSE_TARGET_LESSONS);
    }
    for (const group of groups) {
      if (
        group.length === 2 &&
        shouldFoldIntroChunk(group[0]!, group[1]!)
      ) {
        lessons.push({
          title: lessonTitleForChunkGroup([group[1]!]),
          summary: "",
          source_chunk_ids: group.map((c) => c.id),
        });
        continue;
      }
      lessons.push({
        title: lessonTitleForChunkGroup(group),
        summary: "",
        source_chunk_ids: group.map((c) => c.id),
      });
    }
  } else {
    const lessonTarget = targets.minLessons;
    const chunksPerLesson = Math.max(
      1,
      Math.ceil(chunkSummaries.length / lessonTarget)
    );

    for (let i = 0; i < chunkSummaries.length; ) {
      const group = chunkSummaries.slice(i, i + chunksPerLesson);
      lessons.push({
        title: lessonTitleForChunkGroup(group),
        summary: "",
        source_chunk_ids: group.map((c) => c.id),
      });
      i += chunksPerLesson;
    }
  }

  const moduleCap = denseSectioned ? DENSE_MAX_MODULES : targets.maxModules;
  const lessonsPerModule = denseSectioned
    ? 2
    : Math.max(1, Math.ceil(lessons.length / targets.maxModules));
  const modules: CourseStructurePlanModule[] = [];
  for (let i = 0; i < lessons.length; i += lessonsPerModule) {
    const group = lessons.slice(i, i + lessonsPerModule);
    modules.push({
      title: moduleTitleFromLessonTitles(group.map((l) => l.title)),
      summary: "",
      lessons: group,
    });
  }

  return {
    title: deriveCourseTitleFromChunkTitles(
      chunkSummaries.map((c) => c.title)
    ),
    description: "",
    modules,
  };
}

/** Apply stable display titles to any structure plan (LLM or deterministic). */
export function normalizeStructurePlanTitles(
  plan: CourseStructurePlan
): CourseStructurePlan {
  const usedModuleTitles = new Set<string>();
  const modules = plan.modules.map((mod, modIndex) => {
    const rawLessonTitles = mod.lessons.map((l) => l.title);
    const modTitleGuess = moduleTitleFromLessonTitles(rawLessonTitles);
    const polished = polishLessonTitlesForModule(rawLessonTitles, modTitleGuess);
    const lessons = mod.lessons.map((lesson, i) => ({
      ...lesson,
      title: polished[i] ?? normalizeIngestDisplayTitle(lesson.title),
    }));
    const title = disambiguateModuleTitle(
      moduleTitleFromLessonTitles(lessons.map((l) => l.title)),
      modIndex,
      usedModuleTitles
    );
    return {
      ...mod,
      title,
      lessons,
    };
  });
  const chunkTitles = modules.flatMap((m) => m.lessons.map((l) => l.title));
  const rawPlanTitle = plan.title?.trim();
  const title =
    rawPlanTitle &&
    !/^a structured course/i.test(rawPlanTitle) &&
    !isBadIngestTitle(rawPlanTitle)
      ? normalizeIngestDisplayTitle(rawPlanTitle)
      : deriveCourseTitleFromChunkTitles(chunkTitles);
  return {
    ...plan,
    title,
    modules,
  };
}
