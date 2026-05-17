"use client";

import { useCallback, useEffect, useState } from "react";
import { MentoredLessonRunner } from "@/components/MentoredLessonRunner";
import { MentoredOnboardingFlow } from "@/components/MentoredOnboardingFlow";
import type { CourseModule, CoursePayload } from "@/types/course";
import type { MentoredOnboardingRecord } from "@/types/mentored";

/**
 * Entry point for the Mentored Learning experience.
 *
 * Decides between the one-time onboarding flow and the lesson runner based
 * on whether the student has completed onboarding for this material yet.
 */
export function MentoredLearningEntry({
  materialId,
  course,
  activeModule,
  onSwitchToFree,
  onAdvanceModule,
}: {
  materialId: string;
  course: CoursePayload;
  activeModule: CourseModule;
  onSwitchToFree: () => void;
  /** Forwarded to MentoredLessonRunner; called when the student finishes a module. */
  onAdvanceModule: (nextModuleId: number) => void;
}) {
  const [onboarding, setOnboarding] =
    useState<MentoredOnboardingRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/mentored/onboarding/${materialId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        onboarding: MentoredOnboardingRecord | null;
      };
      setOnboarding(body.onboarding);
      setError(null);
    } catch (e) {
      console.error("[MentoredLearningEntry]", e);
      setError("Could not load your tutor session.");
    } finally {
      setLoaded(true);
    }
  }, [materialId]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400">
        Loading your tutor session…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
        <p className="font-semibold">Could not start Mentored Learning</p>
        <p className="mt-2">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 inline-flex items-center rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
        >
          Try again
        </button>
      </div>
    );
  }

  const onboardingDone = Boolean(onboarding?.completedAt);

  if (!onboardingDone) {
    return (
      <MentoredOnboardingFlow
        materialId={materialId}
        course={course}
        existing={onboarding}
        onComplete={(completed) => {
          setOnboarding(completed);
        }}
        onSkipToFree={onSwitchToFree}
      />
    );
  }

  return (
    <MentoredLessonRunner
      materialId={materialId}
      course={course}
      activeModule={activeModule}
      onboarding={onboarding!}
      onSwitchToFree={onSwitchToFree}
      onAdvanceModule={onAdvanceModule}
    />
  );
}
