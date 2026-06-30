/**
 * One-off data cleanup: strip "strikethrough self-correction" markup from
 * EXISTING courses' stored content — WITHOUT regenerating anything.
 *
 * Some generated lessons contain a crossed-out "error" followed by its
 * correction (markdown `~~wrong~~ right`, HTML `<del>…</del>`, `~~X~~ → Y`,
 * etc). The CoursePlayer renders the strikethrough literally, so learners see
 * the mistake plus the fix. This script deletes the struck-out text and keeps
 * the final clean text in every student-facing field.
 *
 * It reuses the SAME `stripStrikethroughCorrections` helper the app uses during
 * normalization (imported from src/lib/ai), so the cleaning logic lives in one
 * place. It mirrors scripts/dedupe-course-redundancy.ts for env loading, the
 * Supabase admin client, the `study_materials.course_payload` /
 * `canonical_payload` shape, and the timestamped backup pattern.
 *
 * Usage:
 *   npx tsx scripts/strip-strikethrough-corrections.ts            # dry-run (safe default, no DB writes)
 *   npx tsx scripts/strip-strikethrough-corrections.ts dry-run    # same as above
 *   npx tsx scripts/strip-strikethrough-corrections.ts apply       # backup + DB writes
 *   DRY_RUN=0 npx tsx scripts/strip-strikethrough-corrections.ts apply
 *
 * Safety:
 *   - Dry-run is the DEFAULT; you must pass `apply` to write.
 *   - Writes a timestamped, verified full backup of every scanned row before
 *     any DB write.
 *   - Only rows whose content actually changed are written back (no-op skips).
 *   - Cleans both `course_payload` (what learners read) and `canonical_payload`
 *     (translation base) when present.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { stripStrikethroughCorrections } from "../src/lib/ai/strip-strikethrough";

// ---------------------------------------------------------------------------
// env (same loader as dedupe-course-redundancy.ts)
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing Supabase admin env vars (URL + service role key)");
}

// ---------------------------------------------------------------------------
// args / mode
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = argv.find((a) => !a.startsWith("--"));
const explicitApply =
  positional === "apply" || argv.includes("--apply") || process.env.DRY_RUN === "0";
const explicitDryRun =
  positional === "dry-run" || argv.includes("--dry-run") || process.env.DRY_RUN === "1";
// Safe default: dry-run unless apply is explicitly requested.
const mode: "dry-run" | "apply" =
  explicitApply && !explicitDryRun ? "apply" : "dry-run";

// ---------------------------------------------------------------------------
// types (structurally compatible with @/types/course)
// ---------------------------------------------------------------------------
type KeyTerm = { term: string; definition: string };
type Lesson = {
  title: string;
  content: string;
  key_terms?: KeyTerm[];
  examples?: string[];
  [k: string]: unknown;
};
type Module = { id: number; title: string; lessons: Lesson[]; quiz?: unknown };
type Payload = { title?: string; description?: string; modules?: Module[] };

type MaterialRow = {
  id: string;
  course_id: string;
  file_name: string;
  course_payload: Payload | null;
  canonical_payload: Payload | null;
};

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ts = () =>
  new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

const BACKUP_DIR = resolve("scripts/backups");

// ---------------------------------------------------------------------------
// cleaning
// ---------------------------------------------------------------------------
/** Clean one string field in place; return 1 if it changed, else 0. */
function cleanField(
  obj: Record<string, unknown>,
  key: string
): number {
  const v = obj[key];
  if (typeof v !== "string") return 0;
  const next = stripStrikethroughCorrections(v);
  if (next !== v) {
    obj[key] = next;
    return 1;
  }
  return 0;
}

/** Mutate a payload in place; return how many text fields were cleaned. */
function cleanPayload(payload: Payload | null): number {
  if (!payload || typeof payload !== "object") return 0;
  let cleaned = 0;

  cleaned += cleanField(payload as Record<string, unknown>, "title");
  cleaned += cleanField(payload as Record<string, unknown>, "description");

  const modules = Array.isArray(payload.modules) ? payload.modules : [];
  for (const mod of modules) {
    if (!mod || typeof mod !== "object") continue;
    cleaned += cleanField(mod as unknown as Record<string, unknown>, "title");

    const lessons = Array.isArray(mod.lessons) ? mod.lessons : [];
    for (const lesson of lessons) {
      if (!lesson || typeof lesson !== "object") continue;
      cleaned += cleanField(lesson as unknown as Record<string, unknown>, "title");
      cleaned += cleanField(lesson as unknown as Record<string, unknown>, "content");

      if (Array.isArray(lesson.examples)) {
        for (let i = 0; i < lesson.examples.length; i++) {
          const e = lesson.examples[i];
          if (typeof e !== "string") continue;
          const next = stripStrikethroughCorrections(e);
          if (next !== e) {
            lesson.examples[i] = next;
            cleaned++;
          }
        }
      }

      if (Array.isArray(lesson.key_terms)) {
        for (const kt of lesson.key_terms) {
          if (!kt || typeof kt !== "object") continue;
          cleaned += cleanField(kt as unknown as Record<string, unknown>, "term");
          cleaned += cleanField(
            kt as unknown as Record<string, unknown>,
            "definition"
          );
        }
      }
    }
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// fetch (paginate so we get every course's material, not just first 1000)
// ---------------------------------------------------------------------------
async function fetchAllMaterials(): Promise<MaterialRow[]> {
  const PAGE = 500;
  const out: MaterialRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("study_materials")
      .select("id, course_id, file_name, course_payload, canonical_payload")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MaterialRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------
function writeBackup(materials: MaterialRow[]): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const path = resolve(BACKUP_DIR, `strikethrough-${ts()}.json`);
  const payload = {
    backedUpAt: new Date().toISOString(),
    materialCount: materials.length,
    materials,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");

  // verify: read back + confirm row count matches
  const reread = JSON.parse(readFileSync(path, "utf8"));
  if ((reread.materials as MaterialRow[]).length !== materials.length) {
    throw new Error("Backup verification failed: material count mismatch");
  }
  return path;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[strikethrough] mode=${mode}`);
  const materials = await fetchAllMaterials();
  console.log(`[strikethrough] study_materials scanned: ${materials.length}`);

  const courseIds = new Set(materials.map((m) => m.course_id));

  // Always back up before any potential write (cheap + matches dedupe precedent).
  const backupPath = writeBackup(materials);
  console.log(`[strikethrough] BACKUP written + verified: ${backupPath}`);

  let materialsChanged = 0;
  let fieldsCleaned = 0;
  const changedCourseIds = new Set<string>();
  const examples: { id: string; file: string; fields: number }[] = [];

  for (const m of materials) {
    const courseCleaned =
      cleanPayload(m.course_payload) + cleanPayload(m.canonical_payload);
    if (courseCleaned === 0) continue;

    materialsChanged++;
    fieldsCleaned += courseCleaned;
    changedCourseIds.add(m.course_id);
    examples.push({ id: m.id, file: m.file_name, fields: courseCleaned });
    console.log(
      `  ~ material ${m.id} file="${m.file_name}" — ${courseCleaned} field(s) cleaned`
    );

    if (mode === "apply") {
      const update: Record<string, unknown> = {};
      if (m.course_payload) update.course_payload = m.course_payload;
      if (m.canonical_payload) update.canonical_payload = m.canonical_payload;
      const { error } = await admin
        .from("study_materials")
        .update(update)
        .eq("id", m.id);
      if (error) {
        console.error(`  ! DB write FAILED for material ${m.id}:`, error.message);
        throw error;
      }
      console.log(`    → DB UPDATED material ${m.id}`);
    }
  }

  // report file
  mkdirSync(BACKUP_DIR, { recursive: true });
  const reportPath = resolve(BACKUP_DIR, `strikethrough-report-${ts()}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        mode,
        materialsScanned: materials.length,
        coursesScanned: courseIds.size,
        materialsChanged,
        coursesChanged: changedCourseIds.size,
        fieldsCleaned,
        examples,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("---");
  console.log(
    `[strikethrough] DONE (${mode}). courses scanned=${courseIds.size} ` +
      `courses changed=${changedCourseIds.size} materials scanned=${materials.length} ` +
      `materials changed=${materialsChanged} fields cleaned=${fieldsCleaned}`
  );
  console.log(`[strikethrough] report: ${reportPath}`);
  if (mode === "dry-run") {
    console.log(
      "[strikethrough] DRY RUN — no database changes were made. Re-run with `apply` to write."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
