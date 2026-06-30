/**
 * One-off data cleanup: remove redundancy from an existing course's stored
 * lesson content via an LLM rewrite — WITHOUT re-uploading PDFs or regenerating.
 *
 * Operates on the `study_materials.course_payload` JSON (what learners read):
 *   course_payload.modules[].lessons[].content
 * Only lesson `content` prose is rewritten. Titles, key_terms, examples,
 * visual_assets, sources, module quizzes, ids, order and counts are preserved.
 *
 * Usage:
 *   npx tsx scripts/dedupe-course-redundancy.ts inspect
 *   npx tsx scripts/dedupe-course-redundancy.ts backup
 *   npx tsx scripts/dedupe-course-redundancy.ts dry-run   # backup + LLM rewrite, NO db write
 *   npx tsx scripts/dedupe-course-redundancy.ts apply      # backup + LLM rewrite + db write
 *
 * Optional flags:
 *   --title "UGBA 102A"     course title to match (default: "UGBA 102A")
 *   --material <uuid>       restrict to one study_materials row
 *
 * Safety:
 *   - Stops if 0 or >1 courses match the title.
 *   - Always writes a timestamped full backup before any rewrite/write.
 *   - Per-lesson safeguards reject suspicious rewrites (length floor + asset
 *     marker preservation) and keep the original content instead.
 *   - Idempotent: re-running on already-deduped content is safe (model leaves
 *     non-redundant lessons unchanged; rejected rewrites keep originals).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
    }
  } catch {}
}
loadEnv();

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SECRET_KEY?.trim();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing Supabase admin env vars (URL + service role key)");
}

const MODEL = process.env.DEDUPE_MODEL?.trim() || "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const mode = (argv[0] && !argv[0].startsWith("--") ? argv[0] : "inspect") as
  | "inspect"
  | "backup"
  | "dry-run"
  | "apply";

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const TITLE = flag("title") ?? "UGBA 102A";
const ONLY_MATERIAL = flag("material");

// ---------------------------------------------------------------------------
// types (structurally compatible with @/types/course)
// ---------------------------------------------------------------------------
type Lesson = {
  title: string;
  content: string;
  key_terms?: unknown;
  examples?: unknown;
  visual_assets?: unknown;
  sources?: unknown;
  [k: string]: unknown;
};
type Module = { id: number; title: string; lessons: Lesson[]; quiz?: unknown };
type Payload = { title: string; description: string; modules: Module[] };

type MaterialRow = {
  id: string;
  course_id: string;
  file_name: string;
  display_locale: string | null;
  base_locale: string | null;
  course_payload: Payload | null;
  canonical_payload: Payload | null;
  created_at: string;
};

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ts = () =>
  new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

const BACKUP_DIR = resolve("scripts/backups");

// ---------------------------------------------------------------------------
// content-protection helpers
// ---------------------------------------------------------------------------
/** Tokens that MUST survive a rewrite verbatim (asset markers + embedded images). */
function protectedTokens(s: string): string[] {
  const out: string[] = [];
  const assetRe = /\{\{\s*asset\s*:[^}]+\}\}/gi;
  const imgRe = /!\[[^\]]*\]\([^)]+\)/g;
  for (const m of s.matchAll(assetRe)) out.push(m[0].replace(/\s+/g, ""));
  for (const m of s.matchAll(imgRe)) out.push(m[0]);
  return out;
}

/** Count markdown table rows (lines that look like `| ... |`). */
function tableRowCount(s: string): number {
  return s.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
}

type LessonCheck = {
  ok: boolean;
  reason?: string;
};

function checkRewrite(original: string, rewritten: string): LessonCheck {
  const origLen = original.trim().length;
  const newLen = rewritten.trim().length;
  if (newLen === 0) return { ok: false, reason: "empty rewrite" };

  // Length floor: dedup removes a portion, not the bulk of unique teaching.
  if (origLen > 200 && newLen < origLen * 0.35) {
    return {
      ok: false,
      reason: `too short (${newLen} < 35% of ${origLen})`,
    };
  }

  // Every protected token in the original must still be present.
  const origNorm = rewritten.replace(/\s+(?=\}\})/g, "");
  for (const tok of protectedTokens(original)) {
    const needle = tok.startsWith("{{") ? tok : tok;
    const hay = tok.startsWith("{{")
      ? origNorm.replace(/\{\{\s*asset\s*:/gi, "{{asset:")
      : rewritten;
    if (!hay.includes(needle)) {
      return { ok: false, reason: `dropped asset/image marker: ${tok.slice(0, 60)}` };
    }
  }

  // Table rows should not be reduced (a duplicated table is the only valid drop,
  // which is rare; be conservative and reject net table-row loss).
  const ot = tableRowCount(original);
  const nt = tableRowCount(rewritten);
  if (ot > 0 && nt < ot) {
    return { ok: false, reason: `lost table rows (${nt} < ${ot})` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// LLM rewrite (per module: handles intra-lesson + cross-lesson redundancy)
// ---------------------------------------------------------------------------
const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 300_000, maxRetries: 2 })
  : null;

function stripFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return s.trim();
}

const SYSTEM = `You are an expert editor cleaning up an existing course's lesson text.
Your ONLY job is to remove REDUNDANCY: passages where a concept is explained in
depth and then explained in depth AGAIN later (within a lesson, or across lessons
in the same module).

STRICT RULES:
- PRESERVE every unique piece of teaching content: concepts, definitions, worked
  examples, named entities, figures, equations, facts, numbers. Do NOT drop them.
- Only remove genuine duplication / near-verbatim repeats. When the same thing is
  taught twice in depth, keep the fuller/better treatment and delete the redundant
  repeat. You MAY replace a deleted repeat with a single brief cross-reference
  sentence (e.g. "(See the earlier discussion of X.)"), but do not pad.
- NEVER invent new facts, figures, numbers, or examples.
- Keep the SAME language as the input.
- Keep ALL special markers EXACTLY as-is: asset markers like {{asset:...}},
  markdown image embeds like ![alt](url), and markdown tables. Do not alter,
  move, or drop them.
- Keep markdown formatting/headings style consistent with the input.
- If a lesson has no real redundancy, return its content UNCHANGED (verbatim).
- Be conservative. When unsure whether something is a true duplicate, KEEP it.

You receive a module's lessons as JSON. Return ONLY a JSON object:
{"lessons":[{"index":<int>,"content":"<rewritten markdown>","changed":<bool>}]}
Return one entry for EVERY input lesson, in the same order, with the same index.
Set "changed": true only when you actually removed redundancy.`;

async function rewriteModule(
  moduleTitle: string,
  lessons: Lesson[]
): Promise<{ index: number; content: string; changed: boolean }[]> {
  if (!anthropic) throw new Error("Missing ANTHROPIC_API_KEY");
  const input = {
    module_title: moduleTitle,
    lessons: lessons.map((l, i) => ({
      index: i,
      title: l.title,
      content: l.content,
    })),
  };
  const prompt = `Module: ${moduleTitle}

Here are the lessons (JSON). De-duplicate per the rules. Return ONLY the JSON object described.

${JSON.stringify(input, null, 2)}`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 32000,
    temperature: 0.1,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(stripFence(text)) as {
    lessons?: { index: number; content: string; changed?: boolean }[];
  };
  if (!parsed.lessons || !Array.isArray(parsed.lessons)) {
    throw new Error("Model did not return a lessons array");
  }
  return parsed.lessons.map((l) => ({
    index: l.index,
    content: l.content,
    changed: l.changed ?? true,
  }));
}

// ---------------------------------------------------------------------------
// course / material resolution
// ---------------------------------------------------------------------------
async function resolveMaterials(): Promise<{
  courseId: string;
  courseTitle: string;
  materials: MaterialRow[];
}> {
  const { data: courses, error: cErr } = await admin
    .from("courses")
    .select("id, title")
    .ilike("title", TITLE);
  if (cErr) throw cErr;
  if (!courses || courses.length === 0) {
    throw new Error(`STOP: no course matched title "${TITLE}".`);
  }
  if (courses.length > 1) {
    throw new Error(
      `STOP: multiple courses matched "${TITLE}": ` +
        courses.map((c) => `${c.title} (${c.id})`).join(", ")
    );
  }
  const course = courses[0];

  let q = admin
    .from("study_materials")
    .select(
      "id, course_id, file_name, display_locale, base_locale, course_payload, canonical_payload, created_at"
    )
    .eq("course_id", course.id)
    .order("created_at", { ascending: true });
  if (ONLY_MATERIAL) q = q.eq("id", ONLY_MATERIAL);

  const { data: materials, error: mErr } = await q;
  if (mErr) throw mErr;
  if (!materials || materials.length === 0) {
    throw new Error(`STOP: course "${course.title}" has no study_materials rows.`);
  }
  return {
    courseId: course.id,
    courseTitle: course.title,
    materials: materials as MaterialRow[],
  };
}

function summarizeMaterial(m: MaterialRow) {
  const modules = m.course_payload?.modules ?? [];
  const lessonCount = modules.reduce(
    (n, mod) => n + (mod.lessons?.length ?? 0),
    0
  );
  const chars = modules.reduce(
    (n, mod) =>
      n + (mod.lessons?.reduce((s, l) => s + (l.content?.length ?? 0), 0) ?? 0),
    0
  );
  return { modules: modules.length, lessons: lessonCount, chars };
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------
function writeBackup(courseTitle: string, materials: MaterialRow[]): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const safe = courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const path = resolve(BACKUP_DIR, `${safe}-${ts()}.json`);
  const payload = {
    backedUpAt: new Date().toISOString(),
    courseTitle,
    materialCount: materials.length,
    materials,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");

  // verify: read back and confirm content present + parseable
  const reread = JSON.parse(readFileSync(path, "utf8"));
  const okCount = (reread.materials as MaterialRow[]).length;
  if (okCount !== materials.length) {
    throw new Error("Backup verification failed: material count mismatch");
  }
  for (const m of reread.materials as MaterialRow[]) {
    if (!m.course_payload || !Array.isArray(m.course_payload.modules)) {
      throw new Error(`Backup verification failed: missing payload for ${m.id}`);
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[dedupe] mode=${mode} title="${TITLE}" model=${MODEL}`);
  const { courseId, courseTitle, materials } = await resolveMaterials();
  console.log(`[dedupe] course: ${courseTitle} (${courseId})`);
  console.log(`[dedupe] study_materials matched: ${materials.length}`);
  for (const m of materials) {
    const s = summarizeMaterial(m);
    console.log(
      `  - ${m.id}  file="${m.file_name}"  locale(display=${m.display_locale ?? "-"}/base=${m.base_locale ?? "-"})  ` +
        `modules=${s.modules} lessons=${s.lessons} contentChars=${s.chars}  canonical=${m.canonical_payload ? "yes" : "no"}`
    );
  }

  if (mode === "inspect") {
    console.log("[dedupe] inspect only — no files written, no db changes.");
    return;
  }

  // Always back up before any rewrite/write.
  const backupPath = writeBackup(courseTitle, materials);
  console.log(`[dedupe] BACKUP written + verified: ${backupPath}`);

  if (mode === "backup") return;

  // dry-run or apply: rewrite per material/module/lesson.
  const report: {
    materialId: string;
    modules: {
      id: number;
      title: string;
      lessons: {
        index: number;
        title: string;
        before: number;
        after: number;
        status: string;
      }[];
    }[];
  }[] = [];

  let totalChanged = 0;
  let totalUnchanged = 0;
  let totalRejected = 0;

  for (const m of materials) {
    const payload = m.course_payload;
    if (!payload?.modules) {
      console.log(`[dedupe] material ${m.id} has no modules — skipping`);
      continue;
    }
    const matReport = { materialId: m.id, modules: [] as (typeof report)[number]["modules"] };
    let materialMutated = false;

    for (const mod of payload.modules) {
      const lessons = mod.lessons ?? [];
      if (lessons.length === 0) continue;
      console.log(
        `[dedupe] material ${m.id} module ${mod.id} "${mod.title}" (${lessons.length} lessons) → LLM`
      );
      let rewrites: { index: number; content: string; changed: boolean }[];
      try {
        rewrites = await rewriteModule(mod.title, lessons);
      } catch (e) {
        console.error(`  ! LLM failed for module ${mod.id}:`, (e as Error).message);
        // keep all lessons unchanged for this module
        for (const l of lessons) totalUnchanged++;
        matReport.modules.push({
          id: mod.id,
          title: mod.title,
          lessons: lessons.map((l, i) => ({
            index: i,
            title: l.title,
            before: l.content.length,
            after: l.content.length,
            status: "llm-error-kept",
          })),
        });
        continue;
      }

      const byIndex = new Map(rewrites.map((r) => [r.index, r]));
      const modReport = {
        id: mod.id,
        title: mod.title,
        lessons: [] as (typeof report)[number]["modules"][number]["lessons"],
      };

      for (let i = 0; i < lessons.length; i++) {
        const lesson = lessons[i];
        const before = lesson.content.length;
        const r = byIndex.get(i);
        let status = "unchanged";
        let after = before;

        if (r && r.changed && r.content.trim() !== lesson.content.trim()) {
          const check = checkRewrite(lesson.content, r.content);
          if (check.ok) {
            lesson.content = r.content;
            after = r.content.length;
            status = "deduped";
            totalChanged++;
            materialMutated = true;
          } else {
            status = `rejected(${check.reason})`;
            totalRejected++;
            totalUnchanged++;
          }
        } else {
          totalUnchanged++;
        }

        modReport.lessons.push({
          index: i,
          title: lesson.title,
          before,
          after,
          status,
        });
        const delta = after - before;
        console.log(
          `    L${i} "${lesson.title.slice(0, 50)}": ${status}` +
            (status === "deduped" ? ` (${before}→${after}, ${delta})` : "")
        );
      }
      matReport.modules.push(modReport);
    }
    report.push(matReport);

    if (mode === "apply" && materialMutated) {
      const { error } = await admin
        .from("study_materials")
        .update({ course_payload: payload })
        .eq("id", m.id);
      if (error) {
        console.error(`  ! DB write FAILED for material ${m.id}:`, error.message);
        throw error;
      }
      console.log(`[dedupe] DB UPDATED material ${m.id}`);
    } else if (mode === "apply") {
      console.log(`[dedupe] material ${m.id} unchanged — no DB write`);
    }
  }

  // Write a per-lesson report + (for dry-run) the proposed payloads next to backup.
  mkdirSync(BACKUP_DIR, { recursive: true });
  const reportPath = resolve(BACKUP_DIR, `report-${ts()}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      { mode, courseTitle, courseId, totalChanged, totalUnchanged, totalRejected, report },
      null,
      2
    ),
    "utf8"
  );
  if (mode === "dry-run") {
    const proposedPath = resolve(BACKUP_DIR, `proposed-${ts()}.json`);
    writeFileSync(
      proposedPath,
      JSON.stringify(
        materials.map((m) => ({ id: m.id, course_payload: m.course_payload })),
        null,
        2
      ),
      "utf8"
    );
    console.log(`[dedupe] DRY RUN — proposed payload written: ${proposedPath}`);
  }
  console.log(`[dedupe] report: ${reportPath}`);
  console.log(
    `[dedupe] DONE. lessons deduped=${totalChanged} unchanged=${totalUnchanged} rejected=${totalRejected}`
  );
  if (mode === "dry-run") console.log("[dedupe] (no database changes were made)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
