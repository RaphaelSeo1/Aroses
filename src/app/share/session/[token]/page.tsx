import { notFound } from "next/navigation";
import Link from "next/link";
import { LessonRichContent } from "@/components/LessonRichContent";
import type { TutorSessionModeTag } from "@/types/tutor-session";

/**
 * Public, anon-readable view of a shared tutor-session recap.
 *
 * Loads the recap from /api/share/tutor-session/[token] using the
 * admin client server-side (the regular RLS policy only lets the
 * owner read). Renders title + metadata + the recap markdown
 * through the same LessonRichContent pipeline used everywhere else.
 *
 * NO transcript, NO uploads, NO live notes — just the recap. The
 * student's name isn't shown either; the surface is intentionally
 * minimal so the link is safe to share without leaking PII.
 */

export const dynamic = "force-dynamic";

const MODE_EMOJI: Record<string, string> = {
  exam_prep: "⚡",
  homework_help: "📝",
  concept_review: "🧠",
  quiz_me: "🎯",
  exploring: "🌱",
};

async function fetchShared(token: string, baseUrl: string) {
  const res = await fetch(
    `${baseUrl}/api/share/tutor-session/${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  return (await res.json()) as {
    title: string;
    modeTag: TutorSessionModeTag | null;
    durationSeconds: number | null;
    startedAt: string;
    endedAt: string | null;
    recapMarkdown: string;
    recapGeneratedAt: string | null;
  };
}

export default async function SharedSessionPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  // Build the absolute origin from the headers so the page works
  // both server-side and behind a reverse proxy.
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const baseUrl = host ? `${proto}://${host}` : "";

  const recap = await fetchShared(token, baseUrl);
  if (!recap) notFound();

  const emoji = recap.modeTag ? MODE_EMOJI[recap.modeTag] ?? "💬" : "💬";
  const dateStr = new Date(
    recap.endedAt ?? recap.startedAt
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const minutes = recap.durationSeconds
    ? `${Math.max(1, Math.round(recap.durationSeconds / 60))} min`
    : null;

  return (
    <main className="min-h-screen bg-app-gradient">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-5 flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-medium text-zinc-500 hover:text-violet-700"
          >
            Aroses
          </Link>
          <span className="text-[11px] text-zinc-500">Shared recap</span>
        </div>

        <article className="rounded-3xl border border-white/60 bg-white/95 px-6 py-10 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md sm:px-12 sm:py-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
            {emoji}{" "}
            {recap.modeTag
              ? recap.modeTag.replace(/_/g, " ")
              : "Tutor session"}
            {" · "}
            {dateStr}
            {minutes ? ` · ${minutes}` : ""}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
            {recap.title}
          </h1>
          <div className="mt-6">
            <LessonRichContent markdown={recap.recapMarkdown} />
          </div>
        </article>

        <p className="mt-6 text-center text-[11px] text-zinc-500">
          Made with{" "}
          <Link href="/" className="font-medium text-violet-700 hover:underline">
            Aroses
          </Link>
        </p>
      </div>
    </main>
  );
}
