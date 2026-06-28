import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SECRET_KEY?.trim();
if (!url || !key) throw new Error("Missing Supabase admin env vars");

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COURSE_QUERY = process.argv[2] ?? "UGBA 102";

async function main() {
  const { data: courses, error: cErr } = await admin
    .from("courses")
    .select("id, title")
    .ilike("title", `%${COURSE_QUERY}%`);
  if (cErr) throw cErr;
  if (!courses || courses.length === 0) {
    console.log(`No course matched "${COURSE_QUERY}".`);
    return;
  }
  console.log(
    "Matched courses:",
    courses.map((c) => `${c.title} (${c.id})`).join(", ")
  );

  const courseIds = courses.map((c) => c.id);
  const { data: jobs, error: jErr } = await admin
    .from("pdf_ingest_jobs")
    .select("id, status, ingest_epoch, original_file_name, course_id")
    .in("course_id", courseIds)
    .not("status", "in", "(complete,failed)");
  if (jErr) throw jErr;

  if (!jobs || jobs.length === 0) {
    console.log("No in-progress builds to stop.");
    return;
  }

  console.log(`Stopping ${jobs.length} in-progress build(s):`);
  for (const job of jobs) {
    const prevEpoch =
      typeof job.ingest_epoch === "number" && Number.isFinite(job.ingest_epoch)
        ? job.ingest_epoch
        : 0;
    const { error: upErr } = await admin
      .from("pdf_ingest_jobs")
      .update({
        status: "failed",
        error_message: "Build cancelled.",
        ingest_phase: null,
        ingest_epoch: prevEpoch + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.log(
      `  ${upErr ? "FAILED" : "stopped"}: ${job.original_file_name ?? job.id} [${job.status}]`
    );
    if (upErr) console.error(upErr);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
