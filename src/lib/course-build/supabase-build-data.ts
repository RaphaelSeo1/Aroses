import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourcePage } from "./clean.ts";
import type {
  BuildData,
  BuildRecord,
  CourseInfoEntry,
  ModuleStepOutput,
  PublishInput,
  SourceRecord,
} from "./handlers.ts";
import type { FiguresStepOutput } from "./figures.ts";
import type { BuildPlan } from "./plan.ts";

/** Public bucket the lesson viewers already load figure images from. */
const FIGURE_BUCKET = "study-material-images";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "not found"}`);
}

const FIGURE_LIST_PAGE = 100;

/** Deletes every figure image a build uploaded. Returns how many were removed. */
export async function removeBuildFigures(admin: SupabaseClient, buildId: string): Promise<number> {
  const { data: build, error } = await admin.from("course_builds").select("user_id").eq("id", buildId).maybeSingle();
  if (error) fail("read build", error);
  if (!build) return 0;
  const folder = `${build.user_id}/course-build/${buildId}`;
  const bucket = admin.storage.from(FIGURE_BUCKET);
  let removed = 0;
  for (;;) {
    const { data: files, error: listError } = await bucket.list(folder, { limit: FIGURE_LIST_PAGE });
    if (listError) fail("list figures", listError);
    if (!files || files.length === 0) return removed;
    const { error: removeError } = await bucket.remove(files.map((f) => `${folder}/${f.name}`));
    if (removeError) fail("remove figures", removeError);
    removed += files.length;
    if (files.length < FIGURE_LIST_PAGE) return removed;
  }
}

let previewColumnMissing = false;

function baseLocale(text: string): "en" | "ko" {
  const hangul = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
  const letters = (text.match(/[A-Za-z\uac00-\ud7af]/g) ?? []).length;
  return letters > 0 && hangul / letters > 0.3 ? "ko" : "en";
}

/** Reads and writes build data with the service-role client (RLS bypassed). */
export function createSupabaseBuildData(admin: SupabaseClient): BuildData {
  const findMaterialId = async (buildId: string): Promise<string | null> => {
    const { data } = await admin.from("course_builds").select("material_id").eq("id", buildId).maybeSingle();
    if (data?.material_id) return String(data.material_id);
    const { data: row } = await admin
      .from("study_materials")
      .select("id")
      .eq("build_id", buildId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    return row?.id ? String(row.id) : null;
  };

  const mergeCourseInfo = async (build: BuildRecord, materialId: string, label: string, info: CourseInfoEntry[]) => {
    await admin.from("course_builds").update({ course_info: { entries: info } }).eq("id", build.id);
    if (info.length === 0) return;
    const { data } = await admin.from("courses").select("course_info").eq("id", build.courseId).maybeSingle();
    const prev = (data?.course_info ?? {}) as { materials?: Array<{ buildId?: string }> };
    const materials = (Array.isArray(prev.materials) ? prev.materials : []).filter((m) => m.buildId !== build.id);
    materials.push({ buildId: build.id, materialId, label, entries: info } as never);
    await admin.from("courses").update({ course_info: { ...prev, materials } }).eq("id", build.courseId);
  };

  return {
    async getBuild(buildId) {
      const { data, error } = await admin
        .from("course_builds")
        .select("id, user_id, course_id, exam_group_id, material_id, output_language, study_goal, usage_reservation_id")
        .eq("id", buildId)
        .maybeSingle();
      if (error || !data) fail("course build", error);
      return {
        id: data.id,
        userId: data.user_id,
        courseId: data.course_id,
        examGroupId: data.exam_group_id,
        materialId: data.material_id,
        outputLanguage: data.output_language,
        studyGoal: data.study_goal,
        usageReservationId: data.usage_reservation_id,
      };
    },

    async savePreview(stepId, owner, preview) {
      if (previewColumnMissing) return;
      const { error } = await admin
        .from("course_build_steps")
        .update({ preview, preview_at: new Date().toISOString() })
        .eq("id", stepId)
        .eq("claimed_by", owner)
        .eq("status", "running");
      // Until migration 116 is applied, lessons simply appear when each module finishes.
      if (error && /preview/.test(error.message) && /column/.test(error.message)) {
        previewColumnMissing = true;
        return;
      }
      if (error) fail("save preview", error);
    },

    async listSources(buildId) {
      const { data, error } = await admin
        .from("course_build_sources")
        .select("id, position, kind, label, storage_path, source_url, pages")
        .eq("build_id", buildId)
        .order("position", { ascending: true });
      if (error || !data) fail("course build sources", error);
      return data.map(
        (r): SourceRecord => ({
          id: r.id,
          position: r.position,
          kind: r.kind,
          label: r.label,
          storagePath: r.storage_path,
          sourceUrl: r.source_url,
          pages: Array.isArray(r.pages) ? (r.pages as SourcePage[]) : null,
        })
      );
    },

    async saveSourcePages(sourceId, pages) {
      const { error } = await admin
        .from("course_build_sources")
        .update({ pages, page_count: pages.length })
        .eq("id", sourceId);
      if (error) fail("save source pages", error);
    },

    async setBuildSize(buildId, sourcePages, spendCapUsd) {
      const { error } = await admin
        .from("course_builds")
        .update({ source_pages: sourcePages, spend_cap_usd: spendCapUsd, updated_at: new Date().toISOString() })
        .eq("id", buildId);
      if (error) fail("set build size", error);
    },

    async savePlan(buildId, plan: BuildPlan, courseInfo) {
      const { error } = await admin
        .from("course_builds")
        .update({ plan, course_info: { entries: courseInfo }, updated_at: new Date().toISOString() })
        .eq("id", buildId);
      if (error) fail("save plan", error);
    },

    async getPlan(buildId) {
      const { data, error } = await admin
        .from("course_build_steps")
        .select("output")
        .eq("build_id", buildId)
        .eq("kind", "plan")
        .eq("status", "done")
        .limit(1)
        .maybeSingle();
      if (error) fail("read plan", error);
      return (data?.output as BuildPlan | null) ?? null;
    },

    async listModuleOutputs(buildId) {
      const { data, error } = await admin
        .from("course_build_steps")
        .select("output")
        .eq("build_id", buildId)
        .eq("kind", "module")
        .eq("status", "done");
      if (error || !data) fail("read modules", error);
      return data
        .map((r) => r.output as ModuleStepOutput | null)
        .filter((o): o is ModuleStepOutput => !!o && !!o.module);
    },

    async saveFigure(build, figureId, image, mime) {
      const ext = mime === "image/jpeg" ? "jpg" : "png";
      const path = `${build.userId}/course-build/${build.id}/${figureId}.${ext}`;
      const { error } = await admin.storage
        .from(FIGURE_BUCKET)
        .upload(path, image, { contentType: mime, upsert: true, cacheControl: "31536000" });
      if (error) fail("upload figure", error);
      const url = admin.storage.from(FIGURE_BUCKET).getPublicUrl(path).data?.publicUrl?.trim();
      if (!url) fail("figure url", null);
      return url;
    },

    async listFigures(buildId) {
      const { data, error } = await admin
        .from("course_build_steps")
        .select("output")
        .eq("build_id", buildId)
        .eq("kind", "figures")
        .eq("status", "done");
      if (error || !data) fail("read figures", error);
      return data.flatMap((r) => (r.output as FiguresStepOutput | null)?.figures ?? []);
    },

    async publish({ build, payload, final, courseInfo }: PublishInput) {
      if (!build.examGroupId) throw new Error("course build has no section");
      const fields: Record<string, unknown> = {
        course_payload: payload,
        file_name: payload.title.slice(0, 200),
        summary: payload.description || payload.title,
      };
      if (final) {
        const locale = baseLocale(JSON.stringify(payload).slice(0, 20_000));
        Object.assign(fields, { canonical_payload: payload, base_locale: locale, display_locale: locale });
      }

      let materialId = await findMaterialId(build.id);
      if (!materialId) {
        const { data: maxRow } = await admin
          .from("study_materials")
          .select("sort_order")
          .eq("exam_group_id", build.examGroupId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        const sortOrder = typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;
        const { data: row, error } = await admin
          .from("study_materials")
          .insert({
            ...fields,
            user_id: build.userId,
            course_id: build.courseId,
            exam_group_id: build.examGroupId,
            key_concepts: [],
            questions: [],
            sort_order: sortOrder,
            build_id: build.id,
          })
          .select("id")
          .single();
        if (error || !row) fail("create material", error);
        materialId = String(row.id);
        await admin.from("course_builds").update({ material_id: materialId }).eq("id", build.id);
        await admin
          .from("course_builds")
          .update({ first_module_at: new Date().toISOString() })
          .eq("id", build.id)
          .is("first_module_at", null);
      } else {
        const { error } = await admin.from("study_materials").update(fields).eq("id", materialId);
        if (error) fail("update material", error);
      }

      if (final) await mergeCourseInfo(build, materialId, payload.title, courseInfo ?? []);
      return materialId;
    },
  };
}
