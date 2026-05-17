"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { ImmersiveLessonRunner } from "@/components/immersive/ImmersiveLessonRunner";
import { ImmersiveModePicker } from "@/components/immersive/ImmersiveModePicker";
import { ImmersiveShell } from "@/components/immersive/ImmersiveShell";
import { MentoredOnboardingFlow } from "@/components/MentoredOnboardingFlow";
import type { CoursePayload } from "@/types/course";
import type {
  CourseMode,
  MentoredOnboardingRecord,
} from "@/types/mentored";

/**
 * Top-level client orchestrator for /dashboard/courses/[courseId]/learn.
 *
 * Flow:
 *   1. ImmersiveModePicker — AI greets the student, they pick a mode.
 *   2. If "free" → persist mode pref + router.push to existing /study page.
 *   3. If "mentored" → persist mode pref + check onboarding:
 *        a. If onboarding incomplete → render MentoredOnboardingFlow inside
 *           a glass shell.
 *        b. If onboarding complete → render ImmersiveLessonRunner.
 *
 * `activeModuleId` is local state so the runner can advance modules without
 * a server roundtrip / URL push. The server-resolved `initialModuleId` seeds it.
 */
export function ImmersiveLearnClient({
  courseId,
  materialId,
  course,
  initialModuleId,
  initialOnboarding,
  initialMode,
}: {
  courseId: string;
  materialId: string;
  course: CoursePayload;
  initialModuleId: number;
  initialOnboarding: MentoredOnboardingRecord | null;
  initialMode: CourseMode | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  type Stage =
    | "picker"
    | "onboarding"
    | "runner"
    | "transitioning-to-free";

  // Returning users (onboarding done, last mode = mentored) skip the welcome
  // ritual and drop straight into the lesson runner. `?intro=1` is the
  // escape hatch — append it to the URL to force the picker (e.g. when the
  // student explicitly wants to switch modes mid-course).
  const forceIntro = searchParams?.get("intro") === "1";
  const canSkipPicker =
    !forceIntro &&
    Boolean(initialOnboarding?.completedAt) &&
    initialMode === "mentored";

  const [stage, setStage] = useState<Stage>(canSkipPicker ? "runner" : "picker");
  const [activeModuleId, setActiveModuleId] = useState<number>(initialModuleId);
  const [onboarding, setOnboarding] = useState<MentoredOnboardingRecord | null>(
    initialOnboarding
  );

  // Derive active module from the payload + current pointer.
  const activeModule = useMemo(() => {
    const found = course.modules.find((m) => m.id === activeModuleId);
    return found ?? course.modules[0];
  }, [activeModuleId, course.modules]);

  // ----- mode persistence (fire-and-forget) -----
  const persistMode = useCallback(
    (mode: CourseMode) => {
      fetch(`/api/mentored/mode/${materialId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }).catch((e) => console.error("[ImmersiveLearnClient persistMode]", e));
    },
    [materialId]
  );

  // ----- mode picker handlers -----
  const onChooseMode = useCallback(
    (mode: CourseMode) => {
      persistMode(mode);
      if (mode === "free") {
        setStage("transitioning-to-free");
        // Reading mode lives at /study; preserve material + module pointer.
        const qs = new URLSearchParams();
        qs.set("material", materialId);
        if (activeModuleId != null) qs.set("module", String(activeModuleId));
        router.push(
          `/dashboard/courses/${courseId}/study?${qs.toString()}`
        );
        return;
      }
      // Mentored — decide whether to onboard first.
      if (onboarding?.completedAt) {
        setStage("runner");
      } else {
        setStage("onboarding");
      }
    },
    [
      activeModuleId,
      courseId,
      materialId,
      onboarding?.completedAt,
      persistMode,
      router,
    ]
  );

  const onExit = useCallback(() => {
    router.push(`/dashboard/courses/${courseId}`);
  }, [courseId, router]);

  const onSwitchToFreeFromRunner = useCallback(() => {
    persistMode("free");
    const qs = new URLSearchParams();
    qs.set("material", materialId);
    if (activeModuleId != null) qs.set("module", String(activeModuleId));
    router.push(`/dashboard/courses/${courseId}/study?${qs.toString()}`);
  }, [activeModuleId, courseId, materialId, persistMode, router]);

  // ----- stage rendering -----
  if (stage === "transitioning-to-free") {
    return (
      <ImmersiveShell>
        <GlassPanel className="mt-16" tone="subtle">
          <p className="text-center text-sm text-zinc-700">
            Opening Free Exploration…
          </p>
        </GlassPanel>
      </ImmersiveShell>
    );
  }

  if (stage === "picker") {
    return (
      <ImmersiveModePicker
        materialId={materialId}
        courseTitle={course.title}
        defaultMode={initialMode ?? undefined}
        onChoose={onChooseMode}
        onExit={onExit}
      />
    );
  }

  if (stage === "onboarding") {
    return (
      <ImmersiveShell
        topBar={
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-white/50 bg-white/45 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/60"
          >
            Exit
          </button>
        }
      >
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
            Quick setup · {course.title}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Let me get to know you first
          </h1>
        </div>
        <GlassPanel className="mt-8" tone="subtle">
          <MentoredOnboardingFlow
            materialId={materialId}
            course={course}
            existing={onboarding}
            onComplete={(completed) => {
              setOnboarding(completed);
              setStage("runner");
            }}
            onSkipToFree={onSwitchToFreeFromRunner}
          />
        </GlassPanel>
      </ImmersiveShell>
    );
  }

  // stage === "runner"
  if (!onboarding?.completedAt) {
    // Should not happen — runner is gated by onboarding completion — but be
    // defensive and fall back to the onboarding glass shell.
    return (
      <ImmersiveShell
        topBar={
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-white/50 bg-white/45 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/60"
          >
            Exit
          </button>
        }
      >
        <GlassPanel className="mt-16" tone="subtle">
          <MentoredOnboardingFlow
            materialId={materialId}
            course={course}
            existing={onboarding}
            onComplete={(completed) => setOnboarding(completed)}
            onSkipToFree={onSwitchToFreeFromRunner}
          />
        </GlassPanel>
      </ImmersiveShell>
    );
  }
  return (
    <ImmersiveLessonRunner
      materialId={materialId}
      course={course}
      activeModule={activeModule}
      onboarding={onboarding}
      onSwitchToFree={onSwitchToFreeFromRunner}
      onExit={onExit}
      onAdvanceModule={(nextId) => setActiveModuleId(nextId)}
    />
  );
}
