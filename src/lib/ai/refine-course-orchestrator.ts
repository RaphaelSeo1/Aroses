import "server-only";
import {
  refineCourseMetadata,
  refineCourseWithInstruction,
  refineCourseWithInstructionStreaming,
  refineModule,
  refineModulesConcurrently,
} from "@/lib/ai/refine-course";
import {
  analyzeRefineIntent,
  coursePayloadChanged,
} from "@/lib/ai/refine-course-intent";
import {
  applyBulkOps,
  type BulkOpResult,
} from "@/lib/ai/refine-course-ops";
import { planRefine, type RefinePlan } from "@/lib/ai/refine-course-planner";
import type { CoursePayload } from "@/types/course";

export type RefineProgress = (message: string) => void;

export type RefineResult = {
  course: CoursePayload;
  applied: string[];
  plan: RefinePlan;
  changed: boolean;
};

/**
 * The orchestrator: plan → execute the cheapest reliable strategy → verify.
 *
 *   bulk          deterministic code edits, no model
 *   per_module    edit target (or all) modules independently, in parallel
 *   whole_course  single global pass (structural edits)
 *   metadata      title/description only
 *
 * `onProgress` streams human phase messages to the client.
 */
export async function runRefine(
  materialId: string,
  course: CoursePayload,
  instruction: string,
  onProgress?: RefineProgress,
): Promise<RefineResult> {
  onProgress?.("Understanding your request…");
  const plan = await planRefine(course, instruction);
  onProgress?.(plan.summary);

  const applied: string[] = [];
  let working = course;

  // 1. Deterministic bulk ops (instant, reliable).
  if (plan.bulkOps.length > 0) {
    const bulk: BulkOpResult = await applyBulkOps(
      materialId,
      working,
      plan.bulkOps,
    );
    working = bulk.course;
    applied.push(...bulk.applied);
  }

  // 2. Model work, if needed.
  if (plan.needsLlm) {
    if (plan.strategy === "metadata") {
      onProgress?.("Rewriting the course title and description…");
      working = await refineCourseMetadata(working, plan.editInstruction);
    } else if (plan.strategy === "whole_course") {
      onProgress?.("Restructuring the whole course…");
      const intent = analyzeRefineIntent(working, plan.editInstruction);
      working = await refineCourseWithInstructionStreaming(
        working,
        plan.editInstruction,
        intent,
      );
    } else {
      // per_module (default)
      const targetIds =
        plan.targetModuleIds.length > 0
          ? new Set(plan.targetModuleIds)
          : null;
      const targets = targetIds
        ? working.modules.filter((m) => targetIds.has(m.id))
        : working.modules;

      if (targets.length === 0) {
        // Planner named modules that don't exist — fall back to global pass.
        const intent = analyzeRefineIntent(working, plan.editInstruction);
        working = await refineCourseWithInstructionStreaming(
          working,
          plan.editInstruction,
          intent,
        );
      } else if (targets.length === 1) {
        onProgress?.(`Editing “${targets[0].title}”…`);
        const edited = await refineModule(
          targets[0],
          plan.editInstruction,
          working.title,
        );
        working = {
          ...working,
          modules: working.modules.map((m) =>
            m.id === edited.id ? edited : m,
          ),
        };
      } else {
        onProgress?.(`Editing ${targets.length} modules…`);
        const { modules: editedTargets, failures } =
          await refineModulesConcurrently(
            targets,
            plan.editInstruction,
            working.title,
            {
              onModuleDone: (done, total) =>
                onProgress?.(`Edited ${done} of ${total} modules…`),
            },
          );
        const byId = new Map(editedTargets.map((m) => [m.id, m]));
        working = {
          ...working,
          modules: working.modules.map((m) => byId.get(m.id) ?? m),
        };
        if (failures > 0) {
          applied.push(
            `${failures} module${failures === 1 ? "" : "s"} couldn't be edited and were left as-is.`,
          );
        }
      }
    }
  }

  const changed = coursePayloadChanged(course, working);
  return { course: working, applied, plan, changed };
}
