import { NextResponse } from "next/server";
import {
  MAX_REVISABLE_SECTIONS,
  ROLLING_SUMMARY_MAX_CHARS,
  streamLiveLectureNotes,
  type RevisableSection,
} from "@/lib/ai/live-lecture-notes";
import { clampNoteInstruction } from "@/lib/ai/note-instruction";
import { pickRelevantSlidePages, pickRevisableByTranscript } from "@/lib/live-notes/pick-relevant-slide-pages";
import {
  isSlideDeckSchemaError,
  loadSessionDeckPages,
  takeDeckSeedBatch,
} from "@/lib/live-notes/slide-pages";
import { sectionsOverlappingDeckPages } from "@/lib/live-notes/fold-note-markdown";
import { deckPagesToSourceUnits } from "@/lib/notes/source-coverage";
import {
  applyCoverageRepairs,
  auditSourceCoverage,
  buildSourceCoverageLedger,
  formatSourceCoverageAudit,
  repairSourceCoverage,
  summarizeSourceCoverageAudit,
  type CoverageNoteSection,
  type CoverageRepair,
} from "@/lib/notes/source-coverage-ledger";
import { fillSeedCoverageGaps } from "@/lib/live-notes/seed-gap-fill";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_INPUT_CHARS = 12_000;
const MAX_SECTION_CHARS = 8_000;
const MAX_EXCERPT_CHARS = 3_000;
const MAX_EXISTING_SECTIONS = 200;
const MAX_EXISTING_NOTES_CHARS = 100_000;
/** Per-section cap for the coverage audit only (no model sees this text). */
const MAX_AUDIT_SECTION_CHARS = 60_000;
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
 *   existingSections?: [{ sectionId, markdown, studentEdited? }],
 *   revisable?: [{ sectionId, markdown, transcriptExcerpt? }]  // relevant ≤6
 * }
 *
 * Streams (text/event-stream):
 *   event: thought data: { "message": string }
 *   event: op    data: { "op": "revise"|"append"|"delete", "sectionId": string }
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
    existingHeadings?: unknown;
    existingSections?: unknown;
    revisable?: unknown;
    screenContext?: unknown;
    noteInstruction?: unknown;
    seedFromDeck?: unknown;
    coverageChecked?: unknown;
  };
  const seedFromDeck = b.seedFromDeck === true;
  /** Deck already audited + repaired earlier (persisted on the notes doc); skip re-auditing on reload. */
  const coverageChecked = b.coverageChecked === true;
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
        .slice(-8)
    : [];
  const existingHeadings = Array.isArray(b.existingHeadings)
    ? b.existingHeadings
        .filter(
          (h): h is { sectionId: string; heading: string } =>
            !!h &&
            typeof h === "object" &&
            typeof (h as { sectionId?: unknown }).sectionId === "string" &&
            (h as { sectionId: string }).sectionId.length > 0 &&
            (h as { sectionId: string }).sectionId.length <= 64 &&
            typeof (h as { heading?: unknown }).heading === "string" &&
            (h as { heading: string }).heading.trim().length > 0
        )
        .slice(0, MAX_EXISTING_SECTIONS)
        .map((h) => ({
          sectionId: h.sectionId,
          heading: h.heading.trim().slice(0, 120),
        }))
    : [];
  let existingChars = 0;
  /**
   * Untruncated copy for the slide-coverage audit: a section cut at
   * MAX_SECTION_CHARS would hide its own tail and get that tail re-copied in.
   */
  const fullSections: Array<{ sectionId: string; markdown: string; studentEdited: boolean }> = [];
  const existingSections = Array.isArray(b.existingSections)
    ? b.existingSections
        .filter(
          (s): s is {
            sectionId: string;
            markdown: string;
            studentEdited?: boolean;
            transcriptExcerpt?: string;
          } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as { sectionId?: unknown }).sectionId === "string" &&
            (s as { sectionId: string }).sectionId.length > 0 &&
            (s as { sectionId: string }).sectionId.length <= 64 &&
            typeof (s as { markdown?: unknown }).markdown === "string"
        )
        .slice(0, MAX_EXISTING_SECTIONS)
        .flatMap((s) => {
          fullSections.push({
            sectionId: s.sectionId,
            markdown: s.markdown.slice(0, MAX_AUDIT_SECTION_CHARS),
            studentEdited: s.studentEdited === true,
          });
          const remaining = MAX_EXISTING_NOTES_CHARS - existingChars;
          if (remaining <= 0) return [];
          const markdown = s.markdown.slice(0, Math.min(MAX_SECTION_CHARS, remaining));
          existingChars += markdown.length;
          return [
            {
              sectionId: s.sectionId,
              markdown,
              studentEdited: s.studentEdited === true,
              transcriptExcerpt:
                typeof s.transcriptExcerpt === "string"
                  ? s.transcriptExcerpt.slice(0, MAX_EXCERPT_CHARS)
                  : undefined,
            },
          ];
        })
    : [];
  const revisable: RevisableSection[] = Array.isArray(b.revisable)
    ? b.revisable
        .filter(
          (s): s is {
            sectionId: string;
            markdown: string;
            studentEdited?: boolean;
            transcriptExcerpt?: string;
          } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as { sectionId?: unknown }).sectionId === "string" &&
            (s as { sectionId: string }).sectionId.length > 0 &&
            (s as { sectionId: string }).sectionId.length <= 64 &&
            typeof (s as { markdown?: unknown }).markdown === "string"
        )
        .slice(0, MAX_REVISABLE_SECTIONS)
        .map((s) => ({
          sectionId: s.sectionId,
          markdown: s.markdown.slice(0, MAX_SECTION_CHARS),
          studentEdited: s.studentEdited === true,
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
    // Every page is drafted. Audit the deck against the client's current
    // sections. Pages the draft skipped get ONE seed-style model pass so the
    // additions read like the rest of the notes; whatever that still leaves
    // missing is copied back deterministically as a rarely-firing safety net.
    if (coverageChecked || deckPages.length === 0) {
      return NextResponse.json({ seedDone: true });
    }
    const ledger = buildSourceCoverageLedger(deckPagesToSourceUnits(deckPages));
    const before = auditSourceCoverage(ledger, fullSections);
    let working: CoverageNoteSection[] = fullSections;
    const repairs: CoverageRepair[] = [];
    let gapPages: number[] = [];
    if (before.counts.missing > 0) {
      try {
        const gap = await fillSeedCoverageGaps({
          deckPages,
          audit: before,
          sections: fullSections,
          rollingSummary:
            typeof session.rolling_summary === "string" ? session.rolling_summary : "",
          lectureTitle: typeof session.title === "string" ? session.title : undefined,
          noteInstruction: clampNoteInstruction(
            typeof b.noteInstruction === "string"
              ? b.noteInstruction
              : await loadNoteInstruction(supabase, "live_lecture_sessions", {
                  id: sessionId,
                  user_id: user.id,
                })
          ),
          userId: user.id,
        });
        gapPages = gap.pageNums;
        if (gap.repairs.length > 0) {
          repairs.push(...gap.repairs);
          working = applyCoverageRepairs(working, gap.repairs);
        }
      } catch (e) {
        console.error("[live-notes seed] gap fill", e);
        void report("live-notes.seed_gap_fill_failed", e, {
          userId: user.id,
          detail: { sessionId },
        });
      }
    }
    const result = repairSourceCoverage(ledger, working);
    repairs.push(...result.repairs);
    console.info(
      `[live-notes seed] source coverage for ${sessionId}: ${formatSourceCoverageAudit(before)}` +
        (gapPages.length > 0 ? ` → model gap fill over page(s) ${gapPages.join(",")}` : "") +
        (result.repairs.length > 0
          ? ` → verbatim safety net (${result.repairs.length} op(s))`
          : "") +
        (repairs.length > 0 ? ` → ${formatSourceCoverageAudit(result.after)}` : "")
    );
    return NextResponse.json({
      seedDone: true,
      pageCount: deckPages.length,
      coverage: summarizeSourceCoverageAudit(before),
      coverageAfterRepair: summarizeSourceCoverageAudit(result.after),
      repairs: repairs.map((r) => ({
        kind: r.kind,
        sectionId: r.sectionId,
        markdown: r.markdown,
        unitIds: r.unitIds,
      })),
    });
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

  const liveDeckPick = seedFromDeck
    ? null
    : pickRelevantSlidePages({
        pages: deckPages,
        transcriptSlice: newSegmentText,
        rollingSummary,
        recentHeadings,
      });
  const deckContext = seedFromDeck
    ? seedBatch!.text
    : liveDeckPick?.text || undefined;

  // Seed: re-rank focused sections by overlap with THIS batch's slide text.
  // The client previously sent only the first N sections in document order,
  // so later pages could not @@revise the matching drafted topics.
  let seedRevisable = revisable;
  if (seedFromDeck && seedBatch && existingSections.length > 0) {
    const ranked = pickRevisableByTranscript(
      existingSections,
      seedBatch.text,
      MAX_REVISABLE_SECTIONS
    );
    const excerptById = new Map<string, string>();
    for (const s of existingSections) {
      if (s.transcriptExcerpt) excerptById.set(s.sectionId, s.transcriptExcerpt);
    }
    for (const s of revisable) {
      if (s.transcriptExcerpt) excerptById.set(s.sectionId, s.transcriptExcerpt);
    }
    seedRevisable = ranked.map((s) => ({
      sectionId: s.sectionId,
      markdown: s.markdown,
      studentEdited: s.studentEdited,
      transcriptExcerpt: excerptById.get(s.sectionId),
    }));
  }

  // Pull sections seeded from the matched deck pages into the focused set.
  if (liveDeckPick && liveDeckPick.pageNums.length > 0) {
    const excerptMap = new Map<string, string>();
    for (const s of existingSections) {
      if (s.transcriptExcerpt) excerptMap.set(s.sectionId, s.transcriptExcerpt);
    }
    for (const s of revisable) {
      if (s.transcriptExcerpt) excerptMap.set(s.sectionId, s.transcriptExcerpt);
    }
    const overlapping = sectionsOverlappingDeckPages(
      existingSections,
      liveDeckPick.pageNums,
      excerptMap
    );
    const have = new Set(revisable.map((s) => s.sectionId));
    for (const s of overlapping) {
      if (have.has(s.sectionId)) continue;
      if (revisable.length >= MAX_REVISABLE_SECTIONS) break;
      revisable.push({
        sectionId: s.sectionId,
        markdown: s.markdown,
        studentEdited: s.studentEdited,
        transcriptExcerpt: excerptMap.get(s.sectionId),
      });
      have.add(s.sectionId);
    }
  }

  // Seed: allow revise against already-drafted sections. Live: client-ranked
  // revisable, plus any sections seeded from the matched deck pages.
  const seedPageFrom =
    seedFromDeck && seedBatch && seedBatch.pages.length > 0
      ? seedBatch.pages[0]!.pageNum
      : undefined;
  const seedPageTo =
    seedFromDeck && seedBatch && seedBatch.pages.length > 0
      ? seedBatch.pages[seedBatch.pages.length - 1]!.pageNum
      : undefined;

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
          existingHeadings,
          existingSections,
          // Seed: use slide-overlap ranking so later batches revise the right topics.
          revisable: seedFromDeck ? seedRevisable : revisable,
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
                // The client keeps calling with seedFromDeck while pages
                // remain; the final call (no pages left) returns the JSON
                // coverage audit + deterministic repairs instead of a stream.
                seedRemaining: seedBatch.remaining,
                seededThrough: seedBatch.throughPage,
                seedPageFrom,
                seedPageTo,
              }
            : liveDeckPick && liveDeckPick.pageNums.length > 0
              ? { matchedDeckPages: liveDeckPick.pageNums }
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
