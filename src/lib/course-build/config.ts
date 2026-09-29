/** Course builder settings. Everything spend-related fails toward "off" / "less". */

export type CourseBuildConfig = {
  enabled: boolean;
  model: string;
  outputTokensPerPage: number;
  capUsdPerPage: number;
  minCapUsd: number;
  defaultDailyCapUsd: number;
  visionMaxCrops: number;
  figuresEnabled: boolean;
  /** Most PDF pages rendered per file when looking for figures. */
  figureMaxPages: number;
  /** Wall-clock budget for finding figures in one file; later pages are skipped. */
  figureTimeBudgetMs: number;
  /** How long the figures step waits for the plan step's page reservation before skipping the vision check. */
  figureReserveWaitMs: number;
  maxStepAttempts: number;
};

type Env = Record<string, string | undefined>;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function readCourseBuildConfig(env: Env = process.env): CourseBuildConfig {
  const flag = env.COURSE_BUILD_ENABLED?.trim().toLowerCase();
  return {
    enabled: flag === "1" || flag === "true" || flag === "on",
    model: env.COURSE_BUILD_MODEL?.trim() || "claude-haiku-4-5",
    outputTokensPerPage: positiveNumber(env.COURSE_BUILD_OUTPUT_TOKENS_PER_PAGE, 200),
    capUsdPerPage: positiveNumber(env.COURSE_BUILD_CAP_USD_PER_PAGE, 0.0025),
    minCapUsd: positiveNumber(env.COURSE_BUILD_MIN_CAP_USD, 0.06),
    defaultDailyCapUsd: positiveNumber(env.COURSE_BUILD_DAILY_CAP_USD, 1),
    visionMaxCrops: nonNegativeInt(env.COURSE_BUILD_VISION_MAX_CROPS, 24),
    figuresEnabled: !["0", "false", "off"].includes(env.COURSE_BUILD_FIGURES?.trim().toLowerCase() ?? ""),
    figureMaxPages: nonNegativeInt(env.COURSE_BUILD_FIGURE_MAX_PAGES, 20),
    figureTimeBudgetMs: Math.max(5_000, nonNegativeInt(env.COURSE_BUILD_FIGURE_TIME_MS, 40_000)),
    figureReserveWaitMs: 120_000,
    maxStepAttempts: Math.min(10, Math.max(1, nonNegativeInt(env.COURSE_BUILD_MAX_STEP_ATTEMPTS, 3))),
  };
}
