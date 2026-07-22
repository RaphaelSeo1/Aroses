/**
 * Background Refine-with-Rose apply job.
 *
 * Lives outside any drawer lifecycle so closing/X never cancels edits.
 * Only {@link stopRefineApplyJob} aborts the in-flight request.
 */

import type { RefinePlan } from "@/lib/ai/refine-course-planner";
import {
  AROSES_COURSE_REFINE_APPLY_START_EVENT,
  AROSES_COURSE_REFINE_LESSON_DELTA_EVENT,
  AROSES_COURSE_REFINE_LESSON_EDIT_EVENT,
  AROSES_COURSE_REFINE_PATCH_EVENT,
  AROSES_COURSE_REFINED_EVENT,
  type ArosesCourseRefineApplyStartDetail,
  type ArosesCourseRefineLessonDeltaDetail,
  type ArosesCourseRefineLessonEditDetail,
  type ArosesCourseRefinePatchDetail,
  type ArosesCourseRefinedDetail,
} from "@/lib/refine-course-events";
import type { CourseModule, CoursePayload } from "@/types/course";

export const AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT =
  "aroses-course-refine-apply-cancelled";

export const AROSES_COURSE_REFINE_APPLY_PROGRESS_EVENT =
  "aroses-course-refine-apply-progress";

export type ArosesCourseRefineApplyCancelledDetail = {
  materialId: string;
  reason: "stopped" | "error";
  message?: string;
};

export type ArosesCourseRefineApplyProgressDetail = {
  materialId: string;
  phaseMessage?: string;
  thinking?: string;
  actionIndex?: number;
  actionTotal?: number;
  actionLabel?: string;
};

type JobArgs = {
  materialId: string;
  instruction: string;
  plan: RefinePlan;
  preferModuleId?: number;
};

type ActiveJob = {
  materialId: string;
  abort: AbortController;
  generation: number;
};

let activeJob: ActiveJob | null = null;
let generationCounter = 0;

export function isRefineApplyJobRunning(materialId?: string): boolean {
  if (!activeJob) return false;
  if (materialId && activeJob.materialId !== materialId) return false;
  return !activeJob.abort.signal.aborted;
}

/** Explicit user stop — the only way to cancel an in-flight apply. */
export function stopRefineApplyJob(materialId?: string): boolean {
  if (!activeJob) return false;
  if (materialId && activeJob.materialId !== materialId) return false;
  const job = activeJob;
  activeJob = null;
  job.abort.abort();
  window.dispatchEvent(
    new CustomEvent(AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT, {
      detail: {
        materialId: job.materialId,
        reason: "stopped",
      } satisfies ArosesCourseRefineApplyCancelledDetail,
    })
  );
  return true;
}

function parseNdjsonBuffer(buffer: string): { lines: unknown[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const lines: unknown[] = [];
  for (const line of parts) {
    const t = line.trim();
    if (!t) continue;
    try {
      lines.push(JSON.parse(t) as unknown);
    } catch {
      /* skip */
    }
  }
  return { lines, rest };
}

function emitProgress(
  materialId: string,
  detail: Omit<ArosesCourseRefineApplyProgressDetail, "materialId">
) {
  window.dispatchEvent(
    new CustomEvent(AROSES_COURSE_REFINE_APPLY_PROGRESS_EVENT, {
      detail: { materialId, ...detail } satisfies ArosesCourseRefineApplyProgressDetail,
    })
  );
}

/**
 * Start (or replace) a background apply. Closing the refine drawer must not
 * call this with a stop — only {@link stopRefineApplyJob} cancels.
 */
export function startRefineApplyJob(args: JobArgs): void {
  // One apply at a time per tab — stop the previous job if still running.
  if (activeJob) {
    const prev = activeJob;
    activeJob = null;
    prev.abort.abort();
    window.dispatchEvent(
      new CustomEvent(AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT, {
        detail: {
          materialId: prev.materialId,
          reason: "stopped",
          message: "Replaced by a new refine request.",
        } satisfies ArosesCourseRefineApplyCancelledDetail,
      })
    );
  }

  const generation = ++generationCounter;
  const abort = new AbortController();
  activeJob = { materialId: args.materialId, abort, generation };

  window.dispatchEvent(
    new CustomEvent(AROSES_COURSE_REFINE_APPLY_START_EVENT, {
      detail: {
        materialId: args.materialId,
      } satisfies ArosesCourseRefineApplyStartDetail,
    })
  );

  void runJob(args, abort, generation);
}

async function runJob(
  args: JobArgs,
  abort: AbortController,
  generation: number
): Promise<void> {
  const { materialId, instruction, plan, preferModuleId } = args;

  const fail = (message: string) => {
    if (activeJob?.generation === generation) activeJob = null;
    window.dispatchEvent(
      new CustomEvent(AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT, {
        detail: {
          materialId,
          reason: "error",
          message,
        } satisfies ArosesCourseRefineApplyCancelledDetail,
      })
    );
  };

  const succeed = () => {
    if (activeJob?.generation === generation) activeJob = null;
    window.dispatchEvent(
      new CustomEvent(AROSES_COURSE_REFINED_EVENT, {
        detail: { materialId } satisfies ArosesCourseRefinedDetail,
      })
    );
  };

  try {
    const res = await fetch("/api/refine-course", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        materialId,
        instruction,
        mode: "apply",
        stream: true,
        plan,
        preferModuleId,
      }),
      signal: abort.signal,
    });

    if (abort.signal.aborted) return;

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("ndjson") || !res.body) {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        fail(
          typeof body.error === "string"
            ? body.error
            : "Could not apply edits."
        );
        return;
      }
      succeed();
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sawDone = false;

    while (true) {
      if (abort.signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return;
      }

      const { done, value } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      const { lines, rest } = parseNdjsonBuffer(buf);
      buf = rest;

      for (const row of lines) {
        if (!row || typeof row !== "object") continue;
        const r = row as {
          type?: string;
          message?: string;
          detail?: string;
          index?: number;
          total?: number;
          label?: string;
          module?: CourseModule;
          moduleId?: number;
          lessonIndex?: number;
          content?: string;
          complete?: boolean;
          start?: number;
          deleteLen?: number;
          insert?: string;
          actionIndex?: number;
          actionTotal?: number;
          applied?: string[];
          course?: CoursePayload;
        };

        if (r.type === "phase" && typeof r.message === "string") {
          emitProgress(materialId, { phaseMessage: r.message });
        } else if (r.type === "thinking" && typeof r.detail === "string") {
          emitProgress(materialId, { thinking: r.detail });
        } else if (r.type === "action") {
          emitProgress(materialId, {
            actionIndex: typeof r.index === "number" ? r.index : undefined,
            actionTotal: typeof r.total === "number" ? r.total : undefined,
            actionLabel: typeof r.label === "string" ? r.label : undefined,
          });
        } else if (
          r.type === "lesson_delta" &&
          typeof r.moduleId === "number" &&
          typeof r.lessonIndex === "number" &&
          typeof r.content === "string"
        ) {
          window.dispatchEvent(
            new CustomEvent(AROSES_COURSE_REFINE_LESSON_DELTA_EVENT, {
              detail: {
                materialId,
                moduleId: r.moduleId,
                lessonIndex: r.lessonIndex,
                content: r.content,
                complete: r.complete === true,
              } satisfies ArosesCourseRefineLessonDeltaDetail,
            })
          );
        } else if (
          r.type === "lesson_edit" &&
          typeof r.moduleId === "number" &&
          typeof r.lessonIndex === "number" &&
          typeof r.start === "number" &&
          typeof r.deleteLen === "number" &&
          typeof r.insert === "string"
        ) {
          window.dispatchEvent(
            new CustomEvent(AROSES_COURSE_REFINE_LESSON_EDIT_EVENT, {
              detail: {
                materialId,
                moduleId: r.moduleId,
                lessonIndex: r.lessonIndex,
                start: r.start,
                deleteLen: r.deleteLen,
                insert: r.insert,
              } satisfies ArosesCourseRefineLessonEditDetail,
            })
          );
        } else if (r.type === "module_patch" && r.module) {
          emitProgress(materialId, {
            actionIndex:
              typeof r.actionIndex === "number" ? r.actionIndex : undefined,
            actionTotal:
              typeof r.actionTotal === "number" ? r.actionTotal : undefined,
            actionLabel: `Writing “${r.module.title}”…`,
            thinking: `Updating module: ${r.module.title}`,
          });
          window.dispatchEvent(
            new CustomEvent(AROSES_COURSE_REFINE_PATCH_EVENT, {
              detail: {
                materialId,
                module: r.module,
                actionIndex: r.actionIndex,
                actionTotal: r.actionTotal,
              } satisfies ArosesCourseRefinePatchDetail,
            })
          );
        } else if (r.type === "error" && typeof r.message === "string") {
          fail(r.message);
          return;
        } else if (r.type === "done") {
          sawDone = true;
          if (Array.isArray(r.applied) && r.applied.length > 0) {
            emitProgress(materialId, {
              phaseMessage: r.applied.join(" "),
            });
          }
        }
      }

      if (done) break;
    }

    if (abort.signal.aborted) return;

    if (!res.ok || !sawDone) {
      fail(
        !sawDone
          ? "No completion signal from the server."
          : "Could not apply edits."
      );
      return;
    }

    succeed();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (abort.signal.aborted) return;
    fail("Network error.");
  }
}
