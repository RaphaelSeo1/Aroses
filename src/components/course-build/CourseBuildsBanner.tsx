import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = {
  id: string;
  status: string;
  plan: { title?: string } | null;
  error_message: string | null;
  created_at: string;
};

const RECENT_FAILURE_MS = 24 * 60 * 60 * 1000;

async function loadBuilds(supabase: SupabaseClient, courseId: string, userId: string): Promise<Row[]> {
  const now = Date.now();
  const { data } = await supabase
    .from("course_builds")
    .select("id, status, plan, error_message, created_at")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .gte("created_at", new Date(now - RECENT_FAILURE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  const builds = (data ?? []) as Row[];
  if (builds.length === 0) return [];

  // A failure is hidden once a newer build from the same sources exists (a retry).
  const { data: sources } = await supabase
    .from("course_build_sources")
    .select("build_id, label")
    .in("build_id", builds.map((b) => b.id));
  const labels = new Map<string, string[]>();
  for (const s of (sources ?? []) as Array<{ build_id: string; label: string }>) {
    labels.set(s.build_id, [...(labels.get(s.build_id) ?? []), s.label]);
  }
  const key = (id: string) => (labels.get(id) ?? []).sort().join("\n");
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const b of builds) {
    const k = key(b.id);
    const retried = k !== "" && seen.has(k);
    seen.add(k);
    if (b.status === "queued" || b.status === "running" || (b.status === "failed" && !retried)) out.push(b);
  }
  return out.slice(0, 6);
}

/** Running builds, and failures from the last day, for a course's workspace. */
export async function CourseBuildsBanner({
  supabase,
  courseId,
  userId,
}: {
  supabase: SupabaseClient;
  courseId: string;
  userId: string;
}) {
  const rows = await loadBuilds(supabase, courseId, userId);
  if (rows.length === 0) return null;

  return (
    <div className="mt-8 space-y-2">
      {rows.map((b) => {
        const failed = b.status === "failed";
        return (
          <Link
            key={b.id}
            href={`/dashboard/courses/${courseId}/build/${b.id}`}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
              failed
                ? "border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100"
                : "border-violet-200 bg-violet-50/80 text-violet-950 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${failed ? "bg-red-500" : "animate-pulse bg-violet-500"}`}
            />
            <span className="min-w-0 flex-1 truncate">
              {failed ? "Build failed: " : "Building: "}
              <span className="font-semibold">{b.plan?.title || "new material"}</span>
              {failed && b.error_message ? <span className="opacity-80"> · {b.error_message}</span> : null}
            </span>
            <span className="shrink-0 text-xs font-semibold">{failed ? "See details" : "Watch"} →</span>
          </Link>
        );
      })}
    </div>
  );
}
