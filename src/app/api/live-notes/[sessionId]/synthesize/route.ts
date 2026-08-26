import { NextResponse } from "next/server";
import {
  MAX_REVISABLE_SECTIONS,
  ROLLING_SUMMARY_MAX_CHARS,
  streamLiveLectureNotes,
  type RevisableSection,
} from "@/lib/ai/live-lecture-notes";
import { clampNoteInstruction } from "@/lib/ai/note-instruction";
import { pickRelevantSlidePages } from "@/lib/live-notes/pick-relevant-slide-pages";
import {
  isSlideDeckSchemaError,
  loadSessionDeckPages,
  takeDeckSeedBatch,
} from "@/lib/live-notes/slide-pages";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_INPUT_CHARS = 12_000;
const MAX_SECTION_CHARS = 5_000;
const MAX_EXCERPT_CHARS = 3_000;
/**
 * Hard per-session cap on Haiku note calls (runaway guard). The client
 * fires roughly every ~45–60s of continuous speech (5s heartbeat gated on
 * ~700 fresh chars + the previous call finishing its typed-out render), so
 * 200 covers a ~2.5–3h lecture at full pace.
 */
const MAX_SYNTHESIZE_CALLS = 200;

/**
 * POST /api/live-notes/[sessionId]/synthesize — SSE.
 *
 * Body: {
 *   newSegmentText?: string,          // required unless seedFromDeck
 *   seedFromDeck?: boolean,           // draft notes from the next unseeded slides
 *   recentHeadings?: string[],
 *   revisable?: [{ sectionId, markdown, transcriptExcerpt? }]  // last ≤4
 * }
 *
 * Streams (text/event-stream):
 *   event: thought data: { "message": string }
 *   event: op    data: { "op": "revise"|"append", "sectionId": string }
 *   event: text  data: { "delta": string }        // body of the active op
   *   event: done  data: { "appendSectionId": string, "seedRemaining"?: number, "seededThrough"?: number }
 *   event: error data: { "message": string }
 *
 * Everything after the model's @@summary marker is withheld from the client
 * and persisted to `live_lecture_sessions.rolling_summary` here — the
 * summary stays server-owned. Revise targets are validated against the ids
 * the client declared revisable (already filtered for student edits); the
 * generator swallows ops for anything else. When the session is capped the
 * route returns JSON `{ capped: true }` (200) instead of a stream.
 */
export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as {
    newSegmentText?: unknown;
    recentHeadings?: unknown;
    revisable?: unknown;
    screenContext?: unknown;
    noteInstruction?: unknown;
    seedFromDeck?: unknown;
  };
  const seedFromDeck = b.seedFromDeck === true;
  if (
    !seedFromDeck &&
    (typeof b.newSegmentText !== "string" || !b.newSegmentText.trim())
  ) {
    return NextResponse.json({ error: "newSegmentText required" }, { status: 400 });
  }
  const screenContext =
    typeof b.screenContext === "string"
      ? b.screenContext.trim().slice(0, 1_800)
      : "";
  const recentHeadings = Array.isArray(b.recentHeadings)
    ? b.recentHeadings
        .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
        .slice(-5)
    : [];
  const revisable: RevisableSection[] = Array.isArray(b.revisable)
    ? b.revisable
        .filter(
          (s): s is { sectionId: string; markdown: string; transcriptExcerpt?: string } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as { sectionId?: unknown }).sectionId === "string" &&
            (s as { sectionId: string }).sectionId.length > 0 &&
            (s as { sectionId: string }).sectionId.length <= 64 &&
            typeof (s as { markdown?: unknown }).markdown === "string"
        )
        .slice(-MAX_REVISABLE_SECTIONS)
        .map((s) => ({
          sectionId: s.sectionId,
          markdown: s.markdown.slice(0, MAX_SECTION_CHARS),
          transcriptExcerpt:
            typeof s.transcriptExcerpt === "string"
              ? s.transcriptExcerpt.slice(0, MAX_EXCERPT_CHARS)
              : undefined,
        }))
    : [];

  const sessionSelect =
    "id, title, status, rolling_summary, synthesize_calls, slides_seeded_through_page";
  let { data: session, error: sessLoadErr } = await supabase
    .from("live_lecture_sessions")
    .select(sessionSelect)
    .eq("id", sessionId)
    .maybeSingle();
  if (sessLoadErr && isSlideDeckSchemaError(sessLoadErr.message)) {
    if (seedFromDeck) {
      return NextResponse.json(
        {
          error:
            "Slide notes need a database update. Apply migrations 102 and 103 in Supabase, then try again.",
        },
        { status: 503 }
      );
    }
    const retry = await supabase
      .from("live_lecture_sessions")
      .select("id, title, status, rolling_summary, synthesize_calls")
      .eq("id", sessionId)
      .maybeSingle();
    session = retry.data as typeof session;
    sessLoadErr = retry.error;
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "completed" || session.status === "failed") {
    return NextResponse.json({ error: "This session has ended." }, { status: 409 });
  }

  const deckPages = await loadSessionDeckPages(supabase, sessionId);
  const seededThrough =
    typeof session.slides_seeded_through_page === "number"
      ? session.slides_seeded_through_page
      : 0;
  const seedBatch = seedFromDeck
    ? takeDeckSeedBatch(deckPages, seededThrough)
    : null;
  if (seedFromDeck && (!seedBatch || seedBatch.pages.length === 0)) {
    return NextResponse.json({ seedDone: true });
  }

  const calls =
    typeof session.synthesize_calls === "number" ? session.synthesize_calls : 0;
  if (calls >= MAX_SYNTHESIZE_CALLS) {
    // Transcript capture keeps working; only the AI note appends stop.
    return NextResponse.json({ capped: true });
  }

  // Count the attempt before the model call so a crash mid-call still burns
  // one slot — the guard is about bounding spend, not exact accounting.
  await supabase
    .from("live_lecture_sessions")
    .update({
      synthesize_calls: calls + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  const rollingSummary =
    typeof session.rolling_summary === "string" ? session.rolling_summary : "";
  const appendSectionId = `s-${crypto.randomUUID().slice(0, 8)}`;
  const newSegmentText =
    typeof b.newSegmentText === "string"
      ? b.newSegmentText.slice(0, MAX_INPUT_CHARS)
      : "";
  const lectureTitle =
    typeof session.title === "string" ? session.title : undefined;

  // Per-session note style request. The DB row is the source of truth; a
  // string in the body is an in-flight override so an edit applies to the
  // very next slice without waiting for the debounced save.
  const noteInstruction =
    typeof b.noteInstruction === "string"
      ? clampNoteInstruction(b.noteInstruction)
      : clampNoteInstruction(
          await loadNoteInstruction(supabase, "live_lecture_sessions", {
            id: sessionId,
            user_id: user.id,
          })
        );

  const deckContext = seedFromDeck
    ? seedBatch!.text
    : pickRelevantSlidePages({
        pages: deckPages,
        transcriptSlice: newSegmentText,
        rollingSummary,
        recentHeadings,
      }).text || undefined;

  const encoder = new TextEncoder();
  const sseLine = (event: string, data: unknown): string =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseLine(event, data)));
        } catch {
          /* client went away */
        }
      };
      try {
        let summary: string | null = null;
        for await (const ev of streamLiveLectureNotes({
          newSegmentText: seedFromDeck
            ? "NO SPEECH YET. Draft notes from the DECK SLIDES."
            : newSegmentText,
          rollingSummary,
          recentHeadings,
          revisable: seedFromDeck ? [] : revisable,
          appendSectionId,
          lectureTitle,
          userId: user.id,
          screenContext: seedFromDeck ? undefined : screenContext || undefined,
          deckContext,
          noteInstruction: noteInstruction || undefined,
          mode: seedFromDeck ? "seed" : "live",
        })) {
          if (ev.type === "thought") {
            send("thought", { message: ev.message });
          } else if (ev.type === "op") {
            send("op", { op: ev.op, sectionId: ev.sectionId });
          } else if (ev.type === "text") {
            send("text", { delta: ev.delta });
          } else if (ev.type === "summary") {
            summary = ev.summary;
          }
        }

        const sessionPatch: {
          rolling_summary?: string;
          slides_seeded_through_page?: number;
          updated_at: string;
        } = { updated_at: new Date().toISOString() };
        if (
          typeof summary === "string" &&
          summary.trim() &&
          summary !== rollingSummary
        ) {
          sessionPatch.rolling_summary = summary
            .trim()
            .slice(0, ROLLING_SUMMARY_MAX_CHARS);
        }
        if (seedFromDeck && seedBatch) {
          sessionPatch.slides_seeded_through_page = seedBatch.throughPage;
        }
        if (
          sessionPatch.rolling_summary !== undefined ||
          sessionPatch.slides_seeded_through_page !== undefined
        ) {
          const { error: patchErr } = await supabase
            .from("live_lecture_sessions")
            .update(sessionPatch)
            .eq("id", sessionId)
            .eq("user_id", user.id);
          if (patchErr && isSlideDeckSchemaError(patchErr.message)) {
            send("error", {
              message:
                "Slide notes need a database update. Apply migration 103_live_lecture_slides_seeded.sql in Supabase, then try again.",
            });
            return;
          }
        }

        send("done", {
          appendSectionId,
          ...(seedFromDeck && seedBatch
            ? {
                seedRemaining: seedBatch.remaining,
                seededThrough: seedBatch.throughPage,
              }
            : {}),
        });
      } catch (e) {
        console.error("[live-notes/synthesize]", e);
        void report("live-notes.synthesize_failed", e, {
          userId: user.id,
          detail: { sessionId },
        });
        send("error", {
          message: seedFromDeck
            ? "Could not draft notes from the uploaded slides."
            : "Could not synthesize notes for this slice.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
