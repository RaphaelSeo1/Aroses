import "server-only";
import {
  refineCourseMetadata,
  refineCourseWithInstructionStreaming,
  refineModuleOps,
  refineModulesConcurrently,
} from "@/lib/ai/refine-course";
import {
  analyzeRefineIntent,
  coursePayloadChanged,
} from "@/lib/ai/refine-course-intent";
import {
  applyLessonEditOps,
  previewLocations,
  type LessonEditOp,
} from "@/lib/ai/refine-lesson-ops";
import {
  applyBulkOps,
  type BulkOpResult,
} from "@/lib/ai/refine-course-ops";
import {
  planRefine,
  type RefinePlan,
  type RefinePreviewEdit,
} from "@/lib/ai/refine-course-planner";
import type { CourseModule, CoursePayload } from "@/types/course";

export type RefineProgress = (message: string) => void;

export type RefineStreamEvent =
  | { type: "phase"; message: string }
  | {
      type: "action";
      index: number;
      total: number;
      label: string;
    }
  | {
      type: "module_patch";
      module: CourseModule;
      actionIndex: number;
      actionTotal: number;
    }
  | {
      type: "lesson_delta";
      moduleId: number;
      lessonIndex: number;
      content: string;
      complete: boolean;
    }
  | {
      type: "lesson_edit";
      moduleId: number;
      lessonIndex: number;
      start: number;
      deleteLen: number;
      insert: string;
    }
  | { type: "thinking"; detail: string };

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
 * `onEvent` streams richer action / module-patch events for live UI.
 */
export async function runRefine(
  materialId: string,
  course: CoursePayload,
  instruction: string,
  onProgress?: RefineProgress,
  onEvent?: (event: RefineStreamEvent) => void,
  /** When provided, skip planning and use this confirmed plan. */
  confirmedPlan?: RefinePlan,
  /** Edit this module first so the open lesson can morph immediately. */
  preferModuleId?: number
): Promise<RefineResult> {
  const emit = (event: RefineStreamEvent) => {
    onEvent?.(event);
    if (event.type === "phase") onProgress?.(event.message);
  };

  emit({ type: "phase", message: "Understanding your request…" });
  emit({
    type: "thinking",
    detail: "Reading your course outline and matching it to the edit request.",
  });

  const plan = confirmedPlan ?? (await planRefine(course, instruction));
  // Never let a small structured edit take the whole-course rewrite path.
  // "Add a key term" / "remove this paragraph" must stay surgical + scoped.
  if (
    plan.strategy === "whole_course" &&
    typeof preferModuleId === "number" &&
    !/\b(merge|split|reorder|reorganiz|restructur|renumber|combine modules)\b/i.test(
      instruction
    )
  ) {
    plan.strategy = "per_module";
    if (plan.targetModuleIds.length === 0) {
      plan.targetModuleIds = [preferModuleId];
    }
  }
  emit({ type: "phase", message: plan.summary });
  emit({
    type: "thinking",
    detail: plan.editInstruction,
  });

  const applied: string[] = [];
  let working = course;

  // Deterministic apply: the plan already carries the exact ops (previewed to
  // the student). Re-apply them in code — no model call, so the write can only
  // touch the previewed spans / structured fields and never rewrites a lesson.
  if (plan.previewOps && plan.previewOps.length > 0) {
    if (plan.bulkOps.length > 0) {
      const bulk = await applyBulkOps(materialId, working, plan.bulkOps);
      working = bulk.course;
      applied.push(...bulk.applied);
    }
    emit({ type: "action", index: 1, total: 1, label: "Applying your edits…" });
    let touched = 0;
    for (const { moduleId, ops } of plan.previewOps) {
      const mod = working.modules.find((m) => m.id === moduleId);
      if (!mod) continue;
      const { module: edited, changes, structuredTouched } =
        applyLessonEditOps(mod, ops);
      if (changes.length === 0 && structuredTouched === 0) continue;
      touched += changes.length + structuredTouched;
      for (const ch of changes) {
        emit({
          type: "lesson_edit",
          moduleId,
          lessonIndex: ch.lessonIndex,
          start: ch.start,
          deleteLen: ch.deleteLen,
          insert: ch.insert,
        });
      }
      working = {
        ...working,
        modules: working.modules.map((m) => (m.id === moduleId ? edited : m)),
      };
      emit({
        type: "module_patch",
        module: edited,
        actionIndex: 1,
        actionTotal: 1,
      });
    }
    // Only short-circuit if the precomputed ops actually applied. If the course
    // drifted since planning (find no longer matches), fall through — but still
    // prefer surgical ops, never a whole-course rewrite for scoped plans.
    if (touched > 0) {
      applied.push(
        `Applied ${touched} surgical edit${touched === 1 ? "" : "s"}.`
      );
      const changed = coursePayloadChanged(course, working);
      return { course: working, applied, plan, changed };
    }
  }

  const editModuleLive = async (
    mod: CourseModule,
    live: boolean
  ): Promise<CourseModule> => {
    // Always surgical. Never fall back to a full-module rewrite — that is what
    // made "add one key term" regenerate the whole course.
    try {
      const { module: edited, changes } = await refineModuleOps(
        mod,
        plan.editInstruction,
        working.title
      );
      if (live) {
        emit({
          type: "thinking",
          detail: `Making ${Math.max(1, changes.length)} surgical edit${changes.length === 1 ? "" : "s"} in “${mod.title}”…`,
        });
        for (const ch of changes) {
          emit({
            type: "lesson_edit",
            moduleId: mod.id,
            lessonIndex: ch.lessonIndex,
            start: ch.start,
            deleteLen: ch.deleteLen,
            insert: ch.insert,
          });
        }
      }
      return edited;
    } catch (e) {
      console.warn(
        `[refine] surgical ops failed for module ${mod.id}; leaving unchanged`,
        e
      );
      return mod;
    }
  };

  // 1. Deterministic bulk ops (instant, reliable).
  if (plan.bulkOps.length > 0) {
    emit({
      type: "action",
      index: 1,
      total: plan.needsLlm ? 2 : 1,
      label: "Applying bulk edits…",
    });
    const bulk: BulkOpResult = await applyBulkOps(
      materialId,
      working,
      plan.bulkOps
    );
    working = bulk.course;
    applied.push(...bulk.applied);
    // Surface bulk result as patches for live morph (one event per changed module).
    for (const mod of working.modules) {
      const before = course.modules.find((m) => m.id === mod.id);
      if (before && JSON.stringify(before) !== JSON.stringify(mod)) {
        emit({
          type: "module_patch",
          module: mod,
          actionIndex: 1,
          actionTotal: plan.needsLlm ? 2 : 1,
        });
      }
    }
  }

  // 2. Model work, if needed.
  if (plan.needsLlm) {
    const actionOffset = plan.bulkOps.length > 0 ? 1 : 0;
    if (plan.strategy === "metadata") {
      emit({
        type: "action",
        index: actionOffset + 1,
        total: actionOffset + 1,
        label: "Rewriting title and description…",
      });
      onProgress?.("Rewriting the course title and description…");
      working = await refineCourseMetadata(working, plan.editInstruction);
    } else if (plan.strategy === "whole_course") {
      emit({
        type: "action",
        index: actionOffset + 1,
        total: actionOffset + 1,
        label: "Restructuring the course…",
      });
      onProgress?.("Restructuring the whole course…");
      const intent = analyzeRefineIntent(working, plan.editInstruction);
      working = await refineCourseWithInstructionStreaming(
        working,
        plan.editInstruction,
        intent
      );
      for (const mod of working.modules) {
        emit({
          type: "module_patch",
          module: mod,
          actionIndex: actionOffset + 1,
          actionTotal: actionOffset + 1,
        });
      }
    } else {
      // per_module (default)
      // CRITICAL: empty targetModuleIds used to mean "all modules", which made
      // "add a key term" rewrite the whole course. When the student has a module
      // open, default to that module unless the plan explicitly targeted many.
      let resolvedIds = plan.targetModuleIds.filter((id) =>
        working.modules.some((m) => m.id === id)
      );
      if (
        resolvedIds.length === 0 &&
        typeof preferModuleId === "number" &&
        working.modules.some((m) => m.id === preferModuleId)
      ) {
        resolvedIds = [preferModuleId];
      }
      const targets =
        resolvedIds.length > 0
          ? working.modules.filter((m) => resolvedIds.includes(m.id))
          : // Last resort: still prefer a single module (first) over rewriting all.
            working.modules.slice(0, 1);

      if (targets.length === 0) {
        // Nothing to edit — do NOT fall through to whole-course streaming.
        applied.push("No matching module to edit.");
      } else if (targets.length === 1) {
        const total = actionOffset + 1;
        const live =
          preferModuleId == null || targets[0].id === preferModuleId;
        emit({
          type: "action",
          index: total,
          total,
          label: `Editing “${targets[0].title}”…`,
        });
        onProgress?.(`Editing “${targets[0].title}”…`);
        const edited = await editModuleLive(targets[0], live);
        working = {
          ...working,
          modules: working.modules.map((m) =>
            m.id === edited.id ? edited : m
          ),
        };
        emit({
          type: "module_patch",
          module: edited,
          actionIndex: total,
          actionTotal: total,
        });
      } else {
        // Prefer the module the student is viewing — stream it first,
        // then finish the rest concurrently so the document updates ASAP.
        const preferred =
          typeof preferModuleId === "number"
            ? targets.find((m) => m.id === preferModuleId)
            : undefined;
        let rest = preferred
          ? targets.filter((m) => m.id !== preferred.id)
          : [...targets];
        const total = actionOffset + targets.length;
        let doneCount = 0;

        const emitModuleDone = (module: CourseModule) => {
          doneCount += 1;
          emit({
            type: "action",
            index: actionOffset + doneCount,
            total,
            label: `Writing “${module.title}”…`,
          });
          emit({
            type: "module_patch",
            module,
            actionIndex: actionOffset + doneCount,
            actionTotal: total,
          });
          onProgress?.(`Edited ${doneCount} of ${targets.length} modules…`);
        };

        const editedById = new Map<number, CourseModule>();
        let failures = 0;

        const firstLive = preferred ?? rest[0];
        if (firstLive) {
          rest = rest.filter((m) => m.id !== firstLive.id);
          onProgress?.(
            preferred
              ? `Editing “${firstLive.title}” first…`
              : `Editing ${targets.length} modules…`
          );
          emit({
            type: "action",
            index: actionOffset + 1,
            total,
            label: "Writing into open lesson…",
          });
          try {
            const edited = await editModuleLive(firstLive, true);
            editedById.set(edited.id, edited);
            emitModuleDone(edited);
          } catch (e) {
            console.warn(
              `[refine] module ${firstLive.id} edit failed; keeping original`,
              e
            );
            editedById.set(firstLive.id, firstLive);
            failures += 1;
            emitModuleDone(firstLive);
          }
        }

        if (rest.length > 0) {
          const { modules: editedRest, failures: restFailures } =
            await refineModulesConcurrently(
              rest,
              plan.editInstruction,
              working.title,
              {
                concurrency: 5,
                onModuleDone: (_done, _t, module) => {
                  editedById.set(module.id, module);
                  emitModuleDone(module);
                },
              }
            );
          for (const m of editedRest) editedById.set(m.id, m);
          failures += restFailures;
        }

        working = {
          ...working,
          modules: working.modules.map((m) => editedById.get(m.id) ?? m),
        };
        if (failures > 0) {
          applied.push(
            `${failures} module${failures === 1 ? "" : "s"} couldn't be edited and were left as-is.`
          );
        }
      }
    }
  }

  const changed = coursePayloadChanged(course, working);
  return { course: working, applied, plan, changed };
}

/** Plan only — used for the confirm / re-specify / decline step. */
export async function planRefineOnly(
  course: CoursePayload,
  instruction: string,
  currentModuleId?: number
): Promise<RefinePlan> {
  const plan = await planRefine(course, instruction, currentModuleId);
  return attachPreviewEdits(course, plan, currentModuleId);
}

/**
 * For scoped per-module edits, precompute the exact surgical ops now so the
 * confirm step can hover a caret / marker over what will change — and so the
 * apply step can replay those ops deterministically (guaranteed no rewrite).
 */
async function attachPreviewEdits(
  course: CoursePayload,
  plan: RefinePlan,
  preferModuleId?: number
): Promise<RefinePlan> {
  if (plan.strategy !== "per_module") return plan;
  let ids = plan.targetModuleIds.filter((id) =>
    course.modules.some((m) => m.id === id)
  );
  // Match apply-time scoping: open module when the plan didn't name one.
  if (
    ids.length === 0 &&
    typeof preferModuleId === "number" &&
    course.modules.some((m) => m.id === preferModuleId)
  ) {
    ids = [preferModuleId];
  }
  // Only preview a small, scoped edit. Broad/all-module edits are skipped.
  if (ids.length === 0 || ids.length > 3) return plan;

  const previewEdits: RefinePreviewEdit[] = [];
  const previewOps: { moduleId: number; ops: LessonEditOp[] }[] = [];

  await Promise.all(
    ids.map(async (id) => {
      const mod = course.modules.find((m) => m.id === id);
      if (!mod) return;
      try {
        const { ops } = await refineModuleOps(
          mod,
          plan.editInstruction,
          course.title
        );
        previewOps.push({ moduleId: id, ops });
        for (const loc of previewLocations(mod, ops)) {
          previewEdits.push({ moduleId: id, ...loc });
        }
      } catch {
        /* no clean ops for this module — skip its preview */
      }
    })
  );

  // Keep previewOps even when there are no content caret spans (e.g. addKeyTerm
  // only). Dropping them used to force the apply path into a full rewrite.
  if (previewOps.length === 0) return plan;
  return {
    ...plan,
    targetModuleIds: ids,
    previewEdits,
    previewOps,
  };
}
