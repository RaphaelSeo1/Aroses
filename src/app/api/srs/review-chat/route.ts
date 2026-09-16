import { NextResponse } from "next/server";
import { streamReviewChat } from "@/lib/ai/review-chat";
import { ensureInlineYourNotesLink } from "@/lib/ai/review-chat-notes-link";
import { buildReviewChatStudentNotes } from "@/lib/ai/review-chat-student-notes";
import { lookAtAttachmentPrompt } from "@/lib/chat/chat-attachment-formats";
import { parseChatAttachments } from "@/lib/chat/chat-attachment-parse";
import { isNotesFocusBucketId, parseNotesFocusBucketNoteId } from "@/lib/notes/notes-focus-bucket";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import { stripChoiceLetterPrefix } from "@/lib/quiz-choice-text";
import { isQuizMcq, type CoursePayload, type CourseQuizItem } from "@/types/course";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGE = 4_000;
const MAX_HISTORY = 12;
const MAX_NOTES = 16_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HistoryTurn = { role: "user" | "assistant"; content: string };

function asHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      out.push({ role, content: content.slice(0, MAX_MESSAGE) });
    }
  }
  return out;
}

function lessonNotesFromPayload(
  payload: unknown,
  moduleId: number
): string {
  if (!payload || typeof payload !== "object") return "";
  const modules = (payload as CoursePayload).modules;
  if (!Array.isArray(modules)) return "";
  const mod = modules.find((m) => m.id === moduleId) ?? modules[0];
  if (!mod) return "";
  const parts: string[] = [`Module ${mod.id}: ${mod.title}`];
  for (const lesson of mod.lessons ?? []) {
    parts.push(`## ${lesson.title}\n${lesson.content ?? ""}`);
    for (const kt of lesson.key_terms ?? []) {
      parts.push(`Key term — ${kt.term}: ${kt.definition}`);
    }
    for (const ex of lesson.examples ?? []) {
      parts.push(`Example: ${ex}`);
    }
  }
  return parts.join("\n\n").slice(0, MAX_NOTES);
}

function describeQuestion(q: CourseQuizItem, revealed: boolean): string {
  const prompt = q.question?.trim() || "(untitled)";
  if (!revealed) {
    if (isQuizMcq(q)) {
      return `Prompt: ${prompt}\nChoices: ${q.choices.map(stripChoiceLetterPrefix).join(" | ")}\n(Answer not revealed yet — do not name the correct letter.)`;
    }
    return `Prompt: ${prompt}\n(Written response — answer not revealed yet.)`;
  }
  if (isQuizMcq(q)) {
    const letter = String.fromCharCode(65 + q.correctIndex);
    return `Prompt: ${prompt}\nChoices: ${q.choices.map(stripChoiceLetterPrefix).join(" | ")}\nCorrect: ${letter}. ${stripChoiceLetterPrefix(q.choices[q.correctIndex] ?? "")}\nExplanation: ${q.explanation ?? ""}`;
  }
  return `Prompt: ${prompt}\nReference: ${q.referenceAnswer ?? ""}\nExplanation: ${q.explanation ?? ""}`;
}

/**
 * POST /api/srs/review-chat — SSE.
 * event: text { channel: "reply", delta }
 * event: done {}
 * event: error { message }
 */
export async function POST(request: Request) {
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
    materialId?: unknown;
    moduleId?: unknown;
    moduleTitle?: unknown;
    courseTitle?: unknown;
    cardKind?: unknown;
    personalItemId?: unknown;
    sourceNoteId?: unknown;
    sourceExcerpt?: unknown;
    question?: unknown;
    revealed?: unknown;
    studentAnswer?: unknown;
    selectedChoice?: unknown;
    grade?: unknown;
    voice?: unknown;
    voiceContinuation?: unknown;
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

  const materialId = typeof b.materialId === "string" ? b.materialId.trim() : "";
  const moduleId =
    typeof b.moduleId === "number" && Number.isFinite(b.moduleId)
      ? b.moduleId
      : Number(b.moduleId);
  const revealed = b.revealed === true;
  const question = b.question as CourseQuizItem | null;
  const studentAnswer =
    typeof b.studentAnswer === "string" ? b.studentAnswer.trim().slice(0, 4_000) : "";
  const selectedChoice =
    typeof b.selectedChoice === "string" ? b.selectedChoice.trim().slice(0, 400) : "";
  let sourceExcerpt =
    typeof b.sourceExcerpt === "string" ? b.sourceExcerpt.trim().slice(0, MAX_NOTES) : "";

  const personalItemId =
    typeof b.personalItemId === "string" && UUID_RE.test(b.personalItemId)
      ? b.personalItemId
      : "";
  let sourceNoteId =
    typeof b.sourceNoteId === "string" && UUID_RE.test(b.sourceNoteId.trim())
      ? b.sourceNoteId.trim()
      : parseNotesFocusBucketNoteId(
          typeof b.materialId === "string" ? b.materialId : null
        );
  if (personalItemId) {
    const excerptRes = await supabase
      .from("user_personal_quiz_items")
      .select("source_excerpt, source_note_id")
      .eq("id", personalItemId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!excerptRes.error && excerptRes.data) {
      if (
        !sourceExcerpt &&
        typeof excerptRes.data.source_excerpt === "string"
      ) {
        sourceExcerpt = excerptRes.data.source_excerpt
          .trim()
          .slice(0, MAX_NOTES);
      }
      if (
        !sourceNoteId &&
        typeof excerptRes.data.source_note_id === "string" &&
        UUID_RE.test(excerptRes.data.source_note_id)
      ) {
        sourceNoteId = excerptRes.data.source_note_id;
      }
    } else if (
      excerptRes.error &&
      !isMissingDbColumnError(
        excerptRes.error,
        "source_excerpt",
        "source_note_id"
      )
    ) {
      /* ignore missing column; keep going */
    }
  }

  let noteTitle = "";
  let noteBody = "";
  if (sourceNoteId) {
    const noteRes = await supabase
      .from("user_notes")
      .select("title, content_text")
      .eq("id", sourceNoteId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!noteRes.error && noteRes.data) {
      if (typeof noteRes.data.title === "string") {
        noteTitle = noteRes.data.title.trim();
      }
      if (typeof noteRes.data.content_text === "string") {
        noteBody = noteRes.data.content_text.trim().slice(0, MAX_NOTES);
      }
    }
    // Soft-fail if the standalone note is empty — try the newest live session
    // linked to this note (content may not have synced yet).
    if (!noteBody) {
      const liveRes = await supabase
        .from("live_lecture_sessions")
        .select("notes_text, title")
        .eq("user_note_id", sourceNoteId)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!liveRes.error && liveRes.data) {
        if (
          typeof liveRes.data.notes_text === "string" &&
          liveRes.data.notes_text.trim()
        ) {
          noteBody = liveRes.data.notes_text.trim().slice(0, MAX_NOTES);
        }
        if (
          !noteTitle &&
          typeof liveRes.data.title === "string" &&
          liveRes.data.title.trim()
        ) {
          noteTitle = liveRes.data.title.trim();
        }
      } else if (
        liveRes.error &&
        !isMissingDbColumnError(liveRes.error, "user_note_id", "notes_text")
      ) {
        /* ignore schema gaps; keep going with excerpt if any */
      }
    }
  }

  const studentNotes = buildReviewChatStudentNotes({
    noteTitle,
    noteBody,
    sourceExcerpt,
    sourceNoteId,
    maxLen: MAX_NOTES,
  });
  const hadStudentNotes = studentNotes.hadStudentNotes;
  const notesLink = studentNotes.notesLink;

  let lessonNotes = "";
  if (materialId && UUID_RE.test(materialId) && !isNotesFocusBucketId(materialId)) {
    const { data: mat } = await supabase
      .from("study_materials")
      .select("course_payload")
      .eq("id", materialId)
      .maybeSingle();
    lessonNotes = lessonNotesFromPayload(
      mat?.course_payload,
      Number.isFinite(moduleId) ? moduleId : 0
    );
  }

  const grade = b.grade && typeof b.grade === "object"
    ? (b.grade as { verdict?: unknown; feedback?: unknown; correct?: unknown })
    : null;

  const activeCardParts = [
    question && typeof question === "object"
      ? describeQuestion(question, revealed)
      : null,
    studentAnswer ? `STUDENT'S WRITTEN ANSWER:\n${studentAnswer}` : null,
    selectedChoice ? `STUDENT SELECTED:\n${selectedChoice}` : null,
    grade
      ? `GRADE: ${String(grade.verdict ?? grade.correct ?? "")}${
          typeof grade.feedback === "string" && grade.feedback.trim()
            ? `\nFeedback: ${grade.feedback.trim()}`
            : ""
        }`
      : null,
  ].filter(Boolean);

  const contextParts = [
    `Course: ${typeof b.courseTitle === "string" && b.courseTitle.trim() ? b.courseTitle.trim() : "Review"}`,
    `Module: ${typeof b.moduleTitle === "string" && b.moduleTitle.trim() ? b.moduleTitle.trim() : "—"}`,
    `Card type: ${b.cardKind === "personal" ? "Focus card (from notes)" : "Module bank"}`,
    lessonNotes
      ? `COURSE LESSONS (this module):\n${lessonNotes}`
      : null,
    attached.text
      ? `ATTACHED FILE${attached.name ? ` (${attached.name})` : ""}:\n${attached.text.slice(0, MAX_NOTES)}`
      : null,
  ].filter(Boolean);

  // Notes sit next to the active card in the model prompt (not only in meta).
  const studentNotesText = [
    studentNotes.contextBlock,
    // Only mention the URL when notes are available; model must use inline
    // [your notes](url) — never a separate "Open your notes" CTA.
    hadStudentNotes && notesLink
      ? `NOTES URL (only when citing notes, link the words "your notes"): ${notesLink}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  let voiceContinuation:
    | {
        spokenBeforeInterrupt: string;
        notYetSpoken: string;
        streamIncomplete?: boolean;
      }
    | undefined;
  if (b.voiceContinuation && typeof b.voiceContinuation === "object") {
    const o = b.voiceContinuation as Record<string, unknown>;
    const spoken =
      typeof o.spokenBeforeInterrupt === "string" ? o.spokenBeforeInterrupt : "";
    const notYet = typeof o.notYetSpoken === "string" ? o.notYetSpoken : "";
    if (spoken.trim() || notYet.trim()) {
      voiceContinuation = {
        spokenBeforeInterrupt: spoken.slice(0, 12_000),
        notYetSpoken: notYet.slice(0, 12_000),
        streamIncomplete: o.streamIncomplete === true,
      };
    }
  }

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
        let fullReply = "";
        for await (const delta of streamReviewChat({
          message,
          history: asHistory(b.history),
          contextText: contextParts.join("\n\n"),
          activeCardText: activeCardParts.join("\n\n"),
          studentNotesText: studentNotesText || null,
          userId: user.id,
          voice: b.voice === true,
          voiceContinuation,
          notesLink:
            !b.voice && hadStudentNotes && notesLink ? notesLink : null,
        })) {
          fullReply += delta;
          send("text", { channel: "reply", delta });
        }
        if (!b.voice && hadStudentNotes && notesLink) {
          const patched = ensureInlineYourNotesLink(
            fullReply,
            notesLink,
            true
          );
          if (patched !== fullReply) {
            send("done", { finalReply: patched });
          } else {
            send("done", {});
          }
        } else {
          send("done", {});
        }
      } catch (e) {
        console.error("[srs/review-chat]", e);
        void report("srs.review_chat_failed", e, { userId: user.id });
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
