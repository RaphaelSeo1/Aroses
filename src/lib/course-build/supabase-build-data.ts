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
import type { BuildPlan } from "./plan.ts";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "not found"}`);
}

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
        .select("id, user_id, course_id, exam_group_id, material_id, output_language, study_goal")
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
      };
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
