/**
 * Builds real courses from local files through the full course-build pipeline
 * (same steps, ledger and caps as production) and reports time and cost.
 * The builder is switched on for this process only.
 *
 * Usage: npx tsx scripts/course-build-run.ts <file.pdf|.pptx|.docx> [...more]
 *   --email you@example.com   account that owns the test course (default: founder)
 *   --course "Title"          test course to build into (created if missing)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { CoursePayload } from "@/types/course";

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^"|"$/g, "");
    }
  } catch {}
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const KIND_BY_EXT: Record<string, "pdf" | "pptx" | "docx"> = { ".pdf": "pdf", ".pptx": "pptx", ".docx": "docx" };
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function renderMarkdown(p: CoursePayload): string {
  const out: string[] = [`# ${p.title}`, "", `_${p.description}_`, ""];
  for (const m of p.modules) {
    out.push(`## Module ${m.id}: ${m.title}`, "");
    for (const l of m.lessons) {
      out.push(`### ${l.title}`);
      if (l.sources?.length) out.push(`_Sources: ${l.sources.map((s) => `${s.fileName} ${s.locator}`).join("; ")}_`);
      out.push("", l.content, "");
      if (l.key_terms.length) out.push(`**Key terms:** ${l.key_terms.map((k) => `${k.term} — ${k.definition}`).join(" · ")}`, "");
      for (const e of l.examples) out.push(`> Example: ${e}`);
      out.push("");
    }
    out.push(`### Quiz (${m.quiz.length})`);
    m.quiz.forEach((q, i) => {
      const d = (q as { difficulty?: string }).difficulty ?? "?";
      if (q.type === "free_response") {
        out.push(`${i + 1}. [FR, ${d}] ${q.question}`, `   - Reference: ${q.referenceAnswer}`);
      } else {
        out.push(`${i + 1}. [MC, ${d}] ${q.question}`);
        q.choices.forEach((c, ci) => out.push(`   - ${ci === q.correctIndex ? "**" : ""}${"ABCD"[ci]}. ${c}${ci === q.correctIndex ? "**" : ""}`));
      }
      out.push(`   - Why: ${q.explanation}`);
    });
    out.push("");
  }
  return out.join("\n");
}

async function main() {
  loadEnv();
  process.env.COURSE_BUILD_ENABLED = "1";
  const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  if (files.length === 0) throw new Error("pass at least one file");

  const { readCourseBuildConfig } = await import("@/lib/course-build/config");
  const { createCourseBuild } = await import("@/lib/course-build/create-build");
  const { runCourseBuild } = await import("@/lib/course-build/drive");
  const { COURSE_BUILD_UPLOAD_BUCKET } = await import("@/lib/course-build/extract-source");
  const { dailyCapUsdForTier } = await import("@/lib/course-build/pricing");
  const { getPdfPageCount } = await import("@/lib/study-ingest/source-images/render-pdf-page");

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const config = readCourseBuildConfig();
  const email = arg("--email", "raphaelxseo@gmail.com");
  const courseTitle = arg("--course", "Course builder test runs");

  let userId: string | null = null;
  for (let page = 1; !userId && page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) throw new Error(`no user ${email}`);

  let { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("user_id", userId)
    .eq("title", courseTitle)
    .maybeSingle();
  if (!course) {
    const r = await admin
      .from("courses")
      .insert({ user_id: userId, title: courseTitle, description: "Test builds from the new course builder." })
      .select("id")
      .single();
    if (r.error) throw r.error;
    course = r.data;
  }
  let { data: section } = await admin
    .from("exam_groups")
    .select("id")
    .eq("course_id", course!.id)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (!section) {
    const r = await admin
      .from("exam_groups")
      .insert({ course_id: course!.id, user_id: userId, name: "Test builds", sort_order: 0 })
      .select("id")
      .single();
    if (r.error) throw r.error;
    section = r.data;
  }

  mkdirSync("/tmp/cb-out", { recursive: true });
  const summary: string[] = [];
  for (const file of files) {
    const kind = KIND_BY_EXT[extname(file).toLowerCase()];
    if (!kind) throw new Error(`unsupported file ${file}`);
    const buf = readFileSync(file);
    const storagePath = `${userId}/${randomUUID()}.${kind}`;
    const up = await admin.storage.from(COURSE_BUILD_UPLOAD_BUCKET).upload(storagePath, buf, { contentType: MIME[kind] });
    if (up.error) throw up.error;
    const estimatedPages = kind === "pdf" ? await getPdfPageCount(buf) : 20;

    const t0 = Date.now();
    const buildId = await createCourseBuild(
      admin,
      {
        userId,
        courseId: course!.id,
        examGroupId: section!.id,
        sources: [{ kind, label: basename(file), storagePath }],
        estimatedPages,
        dailyCapUsd: dailyCapUsdForTier(null, config),
      },
      config
    );
    console.log(`\n▶ ${basename(file)} (${estimatedPages} pages) build ${buildId}`);
    const outcome = await runCourseBuild(buildId, {
      log: (msg, extra) => console.log(`  · ${msg}`, extra ? JSON.stringify(extra) : ""),
    });
    const t1 = Date.now();

    const { data: b } = await admin
      .from("course_builds")
      .select("status, error_code, error_message, first_module_at, completed_at, created_at, material_id, spend_cap_usd, source_pages, plan")
      .eq("id", buildId)
      .single();
    const { data: ledger } = await admin
      .from("course_build_ai_ledger")
      .select("purpose, status, input_tokens, output_tokens, cost_usd, est_cost_usd, max_output_tokens, refusal_reason")
      .eq("build_id", buildId)
      .order("created_at");
    const { data: steps } = await admin
      .from("course_build_steps")
      .select("kind, ordinal, status, attempts, started_at, finished_at, last_error")
      .eq("build_id", buildId)
      .order("wave")
      .order("ordinal");
    const cost = (ledger ?? []).reduce((s, l) => s + Number(l.cost_usd ?? 0), 0);
    const inTok = (ledger ?? []).reduce((s, l) => s + Number(l.input_tokens ?? 0), 0);
    const outTok = (ledger ?? []).reduce((s, l) => s + Number(l.output_tokens ?? 0), 0);
    const created = new Date(b!.created_at).getTime();
    const firstModule = b!.first_module_at ? (new Date(b!.first_module_at).getTime() - created) / 1000 : null;

    let payload: CoursePayload | null = null;
    if (b!.material_id) {
      const { data: m } = await admin.from("study_materials").select("course_payload").eq("id", b!.material_id).single();
      payload = m!.course_payload as CoursePayload;
      const slug = basename(file, extname(file)).replace(/[^a-z0-9]+/gi, "-").slice(0, 50);
      writeFileSync(`/tmp/cb-out/${slug}.md`, renderMarkdown(payload));
      writeFileSync(`/tmp/cb-out/${slug}.json`, JSON.stringify({ build: b, ledger, steps, payload }, null, 2));
    }

    const lessons = payload?.modules.reduce((s, m) => s + m.lessons.length, 0) ?? 0;
    const quiz = payload?.modules.reduce((s, m) => s + m.quiz.length, 0) ?? 0;
    const line = [
      `${basename(file)}: ${outcome.outcome === "finished" ? outcome.status : outcome.outcome}${b!.error_code ? ` (${b!.error_code}: ${b!.error_message})` : ""}`,
      `  pages ${b!.source_pages}, cap $${Number(b!.spend_cap_usd).toFixed(4)}, modules ${payload?.modules.length ?? 0}, lessons ${lessons}, quiz ${quiz}`,
      `  first module ${firstModule?.toFixed(1) ?? "—"}s, total ${((t1 - t0) / 1000).toFixed(1)}s`,
      `  cost $${cost.toFixed(5)} (${inTok} in / ${outTok} out, ${ledger?.length ?? 0} calls)`,
      ...(ledger ?? []).map(
        (l) => `    ${l.purpose.padEnd(10)} ${l.status.padEnd(8)} in ${l.input_tokens ?? "-"} out ${l.output_tokens ?? "-"}/${l.max_output_tokens} $${Number(l.cost_usd ?? 0).toFixed(5)}${l.refusal_reason ? ` refused:${l.refusal_reason}` : ""}`
      ),
      ...(steps ?? [])
        .filter((s) => s.attempts > 1 || s.last_error)
        .map((s) => `    retry ${s.kind}#${s.ordinal} attempts ${s.attempts}: ${s.last_error ?? ""}`),
    ].join("\n");
    console.log(line);
    summary.push(line);
  }
  console.log(`\n==== summary ====\n${summary.join("\n\n")}\n\nCourse output written to /tmp/cb-out/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
