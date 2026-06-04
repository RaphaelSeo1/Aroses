import Anthropic from "@anthropic-ai/sdk";
import { stripJsonFence } from "@/lib/ai/course-payload";
import type { AggregatedCourseContent } from "@/lib/marketplace/aggregate-course-content";
import type {
  OriginalityReviewResult,
  QualityReviewResult,
} from "@/lib/marketplace/types";

const FAST_MODEL = "claude-haiku-4-5";

const MIN_LESSONS = 3;
const MIN_AVG_LESSON_CHARS = 400;
const MIN_QUALITY_SCORE = 6;

function heuristicQualityFail(stats: AggregatedCourseContent): string[] {
  const flags: string[] = [];
  if (stats.materialCount === 0) flags.push("No study materials uploaded.");
  if (stats.lessonCount < MIN_LESSONS) {
    flags.push(`Only ${stats.lessonCount} lessons (minimum ${MIN_LESSONS}).`);
  }
  if (stats.avgLessonChars < MIN_AVG_LESSON_CHARS) {
    flags.push(
      `Lessons average ${stats.avgLessonChars} characters (minimum ${MIN_AVG_LESSON_CHARS}).`
    );
  }
  if (stats.quizCount < 1) {
    flags.push("No practice quiz questions found.");
  }
  return flags;
}

const REVIEW_SYSTEM = `You review student-created study courses before they can be sold on a learning platform.

Output ONLY JSON:
{
  "qualityScore": number,
  "qualityPassed": boolean,
  "qualityFlags": string[],
  "qualitySummary": string,
  "originalityFlagged": boolean,
  "originalityConfidence": "low"|"medium"|"high",
  "originalityReasons": string[]
}

Quality rules:
- Score 1-10 for genuine educational substance (not AI filler).
- qualityPassed false if score < 6 OR mostly empty/boilerplate OR incoherent structure.
- Flag thin courses, duplicate fluff, generic AI slop.

Originality / copyright risk rules:
- originalityFlagged TRUE if content reads like textbook/publisher prose, includes "do not copy/distribute", references commercial textbook titles as source material, or appears to be professor/institution slides republished.
- When uncertain about originality, set originalityFlagged true and confidence medium.
- Student-written notes and original explanations should NOT be flagged.

Be strict on copyright risk; be fair on student originality.`;

export type ListingReviewOutcome = {
  quality: QualityReviewResult;
  originality: OriginalityReviewResult;
};

export async function reviewCourseForListing(input: {
  courseTitle: string;
  courseDescription: string;
  stats: AggregatedCourseContent;
}): Promise<ListingReviewOutcome> {
  const now = new Date().toISOString();
  const heuristicFlags = heuristicQualityFail(input.stats);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const passed = heuristicFlags.length === 0;
    return {
      quality: {
        passed,
        score: passed ? 7 : 4,
        flags: heuristicFlags.length
          ? heuristicFlags
          : ["AI review unavailable; passed heuristics only."],
        summary: passed
          ? "Passed basic structure checks."
          : "Failed basic structure checks.",
        reviewed_at: now,
        stats: {
          lessonCount: input.stats.lessonCount,
          avgLessonChars: input.stats.avgLessonChars,
          moduleCount: input.stats.moduleCount,
          quizCount: input.stats.quizCount,
        },
      },
      originality: {
        flagged: true,
        confidence: "medium",
        reasons: ["Automated copyright review unavailable — manual review required."],
        reviewed_at: now,
      },
    };
  }

  const user = `COURSE TITLE: ${input.courseTitle.slice(0, 200)}
DESCRIPTION: ${input.courseDescription.slice(0, 800)}
STATS: ${input.stats.lessonCount} lessons, ${input.stats.moduleCount} modules, ${input.stats.quizCount} quiz items, avg ${input.stats.avgLessonChars} chars/lesson, ${input.stats.materialCount} materials.

SAMPLE CONTENT:
"""
${input.stats.sampleText.slice(0, 6000)}
"""`;

  try {
    const anthropic = new Anthropic({
      apiKey,
      timeout: 30_000,
      maxRetries: 0,
    });
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 600,
      temperature: 0.1,
      system: REVIEW_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text");
    const raw = stripJsonFence(block.text).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;

    const score =
      typeof parsed.qualityScore === "number"
        ? Math.max(1, Math.min(10, Math.round(parsed.qualityScore)))
        : 5;
    const aiPassed = parsed.qualityPassed === true && score >= MIN_QUALITY_SCORE;
    const aiFlags = Array.isArray(parsed.qualityFlags)
      ? parsed.qualityFlags
          .map((f) => (typeof f === "string" ? f.trim() : ""))
          .filter((f) => f.length > 0)
      : [];
    const allFlags = [...new Set([...heuristicFlags, ...aiFlags])];
    const passed = aiPassed && heuristicFlags.length === 0;

    const originalityFlagged = parsed.originalityFlagged === true;
    const confidence =
      parsed.originalityConfidence === "high"
        ? "high"
        : parsed.originalityConfidence === "low"
          ? "low"
          : "medium";
    const originalityReasons = Array.isArray(parsed.originalityReasons)
      ? parsed.originalityReasons
          .map((r) => (typeof r === "string" ? r.trim() : ""))
          .filter((r) => r.length > 0)
      : [];

    return {
      quality: {
        passed,
        score,
        flags: allFlags,
        summary:
          typeof parsed.qualitySummary === "string"
            ? parsed.qualitySummary.trim()
            : passed
              ? "Meets quality bar."
              : "Below quality bar.",
        reviewed_at: now,
        stats: {
          lessonCount: input.stats.lessonCount,
          avgLessonChars: input.stats.avgLessonChars,
          moduleCount: input.stats.moduleCount,
          quizCount: input.stats.quizCount,
        },
      },
      originality: {
        flagged: originalityFlagged,
        confidence,
        reasons: originalityReasons,
        reviewed_at: now,
      },
    };
  } catch (e) {
    console.error("[reviewCourseForListing]", e);
    const passed = heuristicFlags.length === 0;
    return {
      quality: {
        passed,
        score: passed ? 6 : 4,
        flags: heuristicFlags.length
          ? heuristicFlags
          : ["AI review failed; check course manually."],
        summary: "Automated review encountered an error.",
        reviewed_at: now,
        stats: {
          lessonCount: input.stats.lessonCount,
          avgLessonChars: input.stats.avgLessonChars,
          moduleCount: input.stats.moduleCount,
          quizCount: input.stats.quizCount,
        },
      },
      originality: {
        flagged: true,
        confidence: "medium",
        reasons: ["Review error — manual check required."],
        reviewed_at: now,
      },
    };
  }
}
