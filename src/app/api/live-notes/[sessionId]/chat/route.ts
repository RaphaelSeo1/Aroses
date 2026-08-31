import { NextResponse } from "next/server";
import { streamLiveLectureChat } from "@/lib/ai/live-lecture-chat";
import { clampNoteInstruction } from "@/lib/ai/note-instruction";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { lookAtAttachmentPrompt } from "@/lib/chat/chat-attachment-formats";
import { parseChatAttachments } from "@/lib/chat/chat-attachment-parse";
import { MAX_CHAT_PDF_CHARS } from "@/lib/live-notes/extract-chat-pdf";
import { pickSlidePagesForChat } from "@/lib/live-notes/pick-relevant-slide-pages";
import { loadSessionDeckPages } from "@/lib/live-notes/slide-pages";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_MESSAGE = 4_000;
const MAX_HISTORY = 12;
const MAX_SECTIONS = 60;

/**
 * POST /api/live-notes/[sessionId]/chat — SSE.
 *
 * Body: {
 *   message: string,
 *   history?: { role: "user"|"assistant", content: string }[],
 *   sections?: { sectionId: string, markdown: string }[],
 *   transcript?: string,
 *   screenContext?: string,
 *   selectedText?: string,
 *   selectedSectionId?: string,
 *   visibleSectionId?: string,
 *   noteInstruction?: string,
 *   attachedPdfText?: string,
 *   attachedPdfName?: string,
 *   attachedFiles?: { name: string, text: string }[]
 * }
 *
 *   event: thought data: { message }
 *   event: op      data: { op, sectionId, color? }
 *   event: text    data: { channel: "reply"|"notes", delta }
 *   event: done    data: { appendSectionId }
 *   event: error   data: { message }
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
    message?: unknown;
    history?: unknown;
    sections?: unknown;
    transcript?: unknown;
    screenContext?: unknown;
    selectedText?: unknown;
    selectedSectionId?: unknown;
    visibleSectionId?: unknown;
    noteInstruction?: unknown;
    attachedPdfText?: unknown;
    attachedPdfName?: unknown;
    attachedFiles?: unknown;
  };
  const attached = parseChatAttachments(b);
  const rawMessage = typeof b.message === "string" ? b.message.trim() : "";
  if (!rawMessage && !attached.text) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  const message =
    rawMessage.slice(0, MAX_MESSAGE) || lookAtAttachmentPrompt(attached.name);

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, title, status, rolling_summary, notes_text, user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "failed") {
    return NextResponse.json({ error: "This session has ended." }, { status: 409 });
  }

  const history = Array.isArray(b.history)
    ? b.history
        .filter(
          (
            t
          ): t is { role: "user" | "assistant"; content: string } =>
            !!t &&
            typeof t === "object" &&
            ((t as { role?: unknown }).role === "user" ||
              (t as { role?: unknown }).role === "assistant") &&
            typeof (t as { content?: unknown }).content === "string"
        )
        .slice(-MAX_HISTORY)
        .map((t) => ({
          role: t.role,
          content: t.content.slice(0, MAX_MESSAGE),
        }))
    : [];

  const sections = Array.isArray(b.sections)
    ? b.sections
        .filter(
          (
            s
          ): s is { sectionId: string; markdown: string } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as { sectionId?: unknown }).sectionId === "string" &&
            (s as { sectionId: string }).sectionId.length > 0 &&
            (s as { sectionId: string }).sectionId.length <= 64 &&
            typeof (s as { markdown?: unknown }).markdown === "string"
        )
        .slice(0, MAX_SECTIONS)
        .map((s) => ({
          sectionId: s.sectionId,
          markdown: s.markdown.slice(0, 4_000),
          studentEdited: Boolean(
            (s as { studentEdited?: unknown }).studentEdited
          ),
        }))
    : [];

  const noteInstruction =
    typeof b.noteInstruction === "string"
      ? clampNoteInstruction(b.noteInstruction)
      : clampNoteInstruction(
          await loadNoteInstruction(supabase, "live_lecture_sessions", {
            id: sessionId,
            user_id: user.id,
          })
        );

  const { data: dbSegments } = await supabase
    .from("live_lecture_segments")
    .select("text")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(80);

  const dbTranscript = (dbSegments ?? [])
    .slice()
    .reverse()
    .map((s) => String(s.text ?? "").trim())
    .filter(Boolean)
    .join(" ");

  const clientTranscript =
    typeof b.transcript === "string" ? b.transcript.trim() : "";
  const transcript = (clientTranscript || dbTranscript).slice(0, 12_000);

  const notesText =
    typeof session.notes_text === "string" ? session.notes_text : "";

  const recentHeadings = sections
    .map((s) => s.markdown.match(/^##\s+(.+)$/m)?.[1]?.trim())
    .filter((h): h is string => Boolean(h))
    .slice(-8);

  let deckText = "";
  try {
    const pages = await loadSessionDeckPages(supabase, sessionId);
    deckText = pickSlidePagesForChat({
      pages,
      message,
      transcript,
      rollingSummary:
        typeof session.rolling_summary === "string"
          ? session.rolling_summary
          : "",
      recentHeadings,
      notesSnippet:
        sections.length > 0
          ? sections
              .map((s) => s.markdown)
              .join("\n")
              .slice(0, 2_500)
          : notesText.slice(0, 2_500),
    }).text;
  } catch {
    deckText = "";
  }

  const appendSectionId = `s-${crypto.randomUUID().slice(0, 8)}`;
  const lectureTitle =
    typeof session.title === "string" ? session.title : undefined;
  const rollingSummary =
    typeof session.rolling_summary === "string" ? session.rolling_summary : "";

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
        for await (const ev of streamLiveLectureChat({
          message,
          history,
          sections,
          lectureTitle,
          rollingSummary,
          notesText,
          transcript,
          deckText: deckText || undefined,
          screenContext:
            typeof b.screenContext === "string"
              ? b.screenContext.trim().slice(0, 1_800)
              : undefined,
          selectedText:
            typeof b.selectedText === "string"
              ? b.selectedText.trim().slice(0, 2_000)
              : undefined,
          selectedSectionId:
            typeof b.selectedSectionId === "string"
              ? b.selectedSectionId.trim().slice(0, 64)
              : undefined,
          visibleSectionId:
            typeof b.visibleSectionId === "string"
              ? b.visibleSectionId.trim().slice(0, 64)
              : undefined,
          noteInstruction: noteInstruction || undefined,
          attachedPdfText: attached.text
            ? attached.text.slice(0, MAX_CHAT_PDF_CHARS)
            : undefined,
          attachedPdfName: attached.name || undefined,
          appendSectionId,
          userId: user.id,
        })) {
          if (ev.type === "thought") {
            send("thought", { message: ev.message });
          } else if (ev.type === "op") {
            send("op", {
              op: ev.op,
              sectionId: ev.sectionId,
              color: ev.color,
            });
          } else if (ev.type === "text") {
            send("text", { channel: ev.channel, delta: ev.delta });
          }
        }
        send("done", { appendSectionId });
      } catch (e) {
        console.error("[live-notes/chat]", e);
        void report("live-notes.chat_failed", e, {
          userId: user.id,
          detail: { sessionId },
        });
        send("error", { message: "Could not answer just now. Try again." });
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
