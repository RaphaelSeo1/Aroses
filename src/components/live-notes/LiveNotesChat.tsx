"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { NotesPanelHandle } from "@/components/immersive/NotesPanel";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import {
  sanitizeChatNotesMarkdown,
  splitStudentFacingReply,
  visibleReplyForStream,
} from "@/lib/live-notes/lecture-chat-protocol";
import { describePdfIngestUploadFailure } from "@/lib/storage-upload-errors";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import { detectIngestFormat, MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createClient } from "@/lib/supabase/client";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thoughts?: string[];
  attachmentName?: string;
};

type NoteOp =
  | { kind: "delete"; sectionId: string }
  | { kind: "highlight"; sectionId: string; color: string }
  | { kind: "revise"; sectionId: string }
  | { kind: "append"; sectionId: string; dividerBefore: boolean }
  | { kind: "notes"; text: string };

const REPLY_TICK_MS = 16;
const REPLY_CPS = 68;
const REPLY_CPS_CATCHUP = 170;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SUGGESTIONS = [
  "What did they just cover?",
  "Add more detail to the last section",
  "Highlight the key definition",
  "Delete the draft that looks wrong",
];

function looksLikeNotesBody(md: string): boolean {
  const t = md.trim();
  if (!t) return false;
  if (/^#{1,3}\s/m.test(t)) return true;
  if (/^\s*[-*]\s/m.test(t)) return true;
  if (/^\s*\d+\.\s/m.test(t)) return true;
  if (/^\|.+\|/m.test(t)) return true;
  return t.split("\n").filter((l) => l.trim()).length >= 3;
}

function looksLikeNoteEditRequest(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\b(fix( the)? wording|reword|rewrite|rephrase|restyle|simplify|shorten|condense|expand|elaborate|make (it|this|that|the notes) |change (that|this|it|the) |add (that|this|it|more|these|the) |put (that|this) |take (that|this) out|delete |remove |highlight |bold )\b/i.test(
      m
    ) ||
    /^(please\s+)?((can|could)\s+you\s+)?(fix|change|reword|rewrite|rephrase|simplify|shorten|condense|expand|delete|remove|highlight|add|put)\b/i.test(
      m
    ) ||
    /\b(add|put|write|include|save)\b.{0,40}\b(to|in|into) the notes\b/i.test(m)
  );
}

function wantsAppendToNotes(message: string): boolean {
  const m = message.trim();
  if (/\b(add more|more detail|expand|elaborate)\b/i.test(m)) return false;
  return (
    /\b(add|put|include|append|write)\b.{0,60}\b(to|in|into) the notes\b/i.test(
      m
    ) || /\badd this (pdf|file|handout|worksheet)\b/i.test(m)
  );
}

function storageKey(sessionId: string) {
  return `aroses.liveNotes.chat.${sessionId}`;
}

function pdfStorageKey(sessionId: string) {
  return `aroses.liveNotes.chatPdf.${sessionId}`;
}

type PendingPdf = { fileName: string; text: string };

const MAX_CHAT_PDFS = 5;
const MAX_CHAT_PDF_CHARS = 16_000;

function pdfFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function loadPendingPdf(sessionId: string): PendingPdf | null {
  try {
    const raw = sessionStorage.getItem(pdfStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as PendingPdf).fileName !== "string" ||
      typeof (parsed as PendingPdf).text !== "string"
    ) {
      return null;
    }
    const fileName = (parsed as PendingPdf).fileName.trim().slice(0, 200);
    const text = (parsed as PendingPdf).text.trim();
    if (!fileName || text.length < 12) return null;
    return { fileName, text: text.slice(0, MAX_CHAT_PDF_CHARS) };
  } catch {
    return null;
  }
}

function loadTurns(sessionId: string): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is ChatTurn =>
          !!t &&
          typeof t === "object" &&
          (t.role === "user" || t.role === "assistant") &&
          typeof t.content === "string" &&
          typeof t.id === "string"
      )
      .map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        thoughts: Array.isArray(t.thoughts)
          ? t.thoughts
              .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
              .slice(0, 24)
          : undefined,
        attachmentName:
          typeof t.attachmentName === "string" && t.attachmentName.trim()
            ? t.attachmentName.trim().slice(0, 200)
            : undefined,
      }))
      .slice(-40);
  } catch {
    return [];
  }
}

export function LiveNotesChat({
  sessionId,
  lectureTitle,
  recentTranscript,
  screenContext,
  noteInstruction,
  notesRef,
  enqueueWriterJob,
  onActivity,
  active = true,
}: {
  sessionId: string;
  lectureTitle: string;
  recentTranscript: string;
  screenContext: string;
  noteInstruction: string;
  notesRef: RefObject<NotesPanelHandle | null>;
  enqueueWriterJob: (job: () => Promise<void>) => void;
  onActivity: (
    kind: "thought" | "status" | "error",
    message: string,
    loc?: { sectionId?: string; sectionLabel?: string }
  ) => void;
  /** When the chat tab is shown — re-pin to the latest turn. */
  active?: boolean;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTurns(sessionId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [pendingPdf, setPendingPdf] = useState<PendingPdf | null>(() =>
    loadPendingPdf(sessionId)
  );
  const [queuedPdfs, setQueuedPdfs] = useState<File[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const pendingPdfRef = useRef(pendingPdf);
  pendingPdfRef.current = pendingPdf;
  const noteInstructionRef = useRef(noteInstruction);
  noteInstructionRef.current = noteInstruction;
  const queuedPdfsRef = useRef(queuedPdfs);
  queuedPdfsRef.current = queuedPdfs;

  const stickToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    stickToLatest();
    const id = window.requestAnimationFrame(() => {
      stickToLatest();
      window.requestAnimationFrame(stickToLatest);
    });
    return () => window.cancelAnimationFrame(id);
  }, [turns, busy, streamingId, active, stickToLatest]);

  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;
    const stick = () => stickToLatest();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(stick) : null;
    ro?.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro?.observe(inner);
    const mo = new MutationObserver(stick);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, [active, stickToLatest, turns.length]);

  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(
        storageKey(sessionId),
        JSON.stringify(turnsRef.current.filter((t) => t.content.trim()).slice(-40))
      );
    } catch {
      /* ignore */
    }
  }, [sessionId, turns, busy]);

  useEffect(() => {
    try {
      if (pendingPdf) {
        sessionStorage.setItem(
          pdfStorageKey(sessionId),
          JSON.stringify(pendingPdf)
        );
      } else {
        sessionStorage.removeItem(pdfStorageKey(sessionId));
      }
    } catch {
      /* ignore */
    }
  }, [sessionId, pendingPdf]);

  const applyNoteOps = useCallback(
    async (ops: NoteOp[], fallbackMarkdown = "") => {
      const run = async () => {
        const writer = notesRef.current?.getStreamWriter();
        if (!writer) {
          onActivity(
            "error",
            "Could not reach the notes editor to apply that change."
          );
          return;
        }

        type Applied = {
          kind: "revise" | "append";
          sectionId: string;
          markdown: string;
          dividerBefore?: boolean;
        };
        const coalesced: Array<
          | Applied
          | { kind: "delete"; sectionId: string }
          | { kind: "highlight"; sectionId: string; color: string }
        > = [];
        for (const item of ops) {
          if (item.kind === "notes") {
            const last = coalesced[coalesced.length - 1];
            if (last && (last.kind === "revise" || last.kind === "append")) {
              last.markdown += item.text;
            }
            continue;
          }
          if (item.kind === "revise") {
            coalesced.push({
              kind: "revise",
              sectionId: item.sectionId,
              markdown: "",
            });
          } else if (item.kind === "append") {
            coalesced.push({
              kind: "append",
              sectionId: item.sectionId,
              markdown: "",
              dividerBefore: item.dividerBefore,
            });
          } else if (item.kind === "delete") {
            coalesced.push({ kind: "delete", sectionId: item.sectionId });
          } else if (item.kind === "highlight") {
            coalesced.push({
              kind: "highlight",
              sectionId: item.sectionId,
              color: item.color,
            });
          }
        }

        const fallbackRaw = sanitizeChatNotesMarkdown(fallbackMarkdown);
        const fallback = looksLikeNotesBody(fallbackRaw) ? fallbackRaw : "";
        notesRef.current?.setStreamingIndicator(true);
        writer.finishOp();
        let applied = 0;
        let failed = 0;

        for (const item of coalesced) {
          if (item.kind === "delete") {
            if (
              writer.deleteSection(item.sectionId, { evenIfStudentEdited: true })
            ) {
              applied += 1;
            } else {
              failed += 1;
            }
          } else if (item.kind === "highlight") {
            if (writer.highlightSection(item.sectionId, item.color)) {
              applied += 1;
            } else {
              failed += 1;
            }
          } else if (item.kind === "revise") {
            let md = sanitizeChatNotesMarkdown(item.markdown);
            if (!md) md = fallback;
            const ok = md
              ? writer.replaceSectionMarkdown(item.sectionId, md, {
                  evenIfStudentEdited: true,
                })
              : false;
            if (ok) {
              applied += 1;
            } else if (md) {
              const appended = writer.appendMarkdown(item.sectionId, md, {
                dividerBefore: true,
              });
              if (appended) applied += 1;
              else failed += 1;
            } else {
              failed += 1;
            }
          } else if (item.kind === "append") {
            let md = sanitizeChatNotesMarkdown(item.markdown);
            if (!md) md = fallback;
            if (
              md &&
              writer.appendMarkdown(item.sectionId, md, {
                dividerBefore: item.dividerBefore,
              })
            ) {
              applied += 1;
            } else {
              failed += 1;
            }
          }
        }

        notesRef.current?.setStreamingIndicator(false);
        let jumpId: string | undefined;
        for (const item of coalesced) {
          if ("sectionId" in item) jumpId = item.sectionId;
        }
        if (applied > 0 && failed === 0) {
          onActivity("status", "Updated your notes.", {
            sectionId: jumpId,
          });
          if (jumpId) notesRef.current?.revealSection(jumpId);
        } else if (applied > 0) {
          onActivity("error", "Some of those note edits didn't apply.", {
            sectionId: jumpId,
          });
        } else {
          onActivity(
            "error",
            "I couldn't change that section in the notes. Select it and ask again."
          );
        }
      };

      enqueueWriterJob(run);
    },
    [enqueueWriterJob, notesRef, onActivity]
  );

  const queuePdfs = useCallback(
    (list: FileList | File[] | undefined) => {
      if (busy || attaching) return;
      const incoming = Array.from(list ?? []);
      if (incoming.length === 0) return;
      setAttachError(null);
      const accepted: File[] = [];
      let skippedType = 0;
      let skippedSize = 0;
      const maxMb = Math.round(MAX_INGEST_DOCUMENT_BYTES / (1024 * 1024));
      for (const file of incoming) {
        const kind = detectIngestFormat(file.name, file.type);
        if (kind !== "pdf") {
          skippedType += 1;
          continue;
        }
        if (file.size > MAX_INGEST_DOCUMENT_BYTES) {
          skippedSize += 1;
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) {
        setAttachError(
          skippedSize > 0
            ? `That PDF is too large (max ${maxMb}MB).`
            : "Attach a PDF."
        );
        return;
      }
      setQueuedPdfs((prev) => {
        const have = new Set(prev.map(pdfFileKey));
        const next = [...prev];
        for (const file of accepted) {
          if (next.length >= MAX_CHAT_PDFS) break;
          const key = pdfFileKey(file);
          if (have.has(key)) continue;
          have.add(key);
          next.push(file);
        }
        return next;
      });
      if (accepted.length + queuedPdfsRef.current.length > MAX_CHAT_PDFS) {
        setAttachError(`You can attach up to ${MAX_CHAT_PDFS} PDFs at a time.`);
      } else if (skippedType > 0 || skippedSize > 0) {
        setAttachError(
          skippedSize > 0
            ? `Skipped ${skippedSize} file${skippedSize === 1 ? "" : "s"} over ${maxMb}MB.`
            : "Only PDFs were added."
        );
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [attaching, busy]
  );

  const confirmQueuedPdfs = useCallback(async (): Promise<PendingPdf | null> => {
    const queued = queuedPdfsRef.current;
    if (queued.length === 0 || busy || attaching) {
      return pendingPdfRef.current;
    }
    setAttachError(null);
    setAttaching(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setAttachError("Sign in again, then retry the upload.");
        return null;
      }

      const extracted: PendingPdf[] = [];
      for (const file of queued) {
        const pathInfo = ingestStoragePathForFile(user.id, file);
        if (!pathInfo) {
          setAttachError("Attach a PDF.");
          return null;
        }
        const { error: upErr } = await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .upload(pathInfo.storagePath, file, {
            contentType: pathInfo.contentType,
            cacheControl: "3600",
            upsert: false,
          });
        if (upErr) {
          setAttachError(
            describePdfIngestUploadFailure(
              typeof upErr.message === "string" ? upErr.message : String(upErr)
            )
          );
          return null;
        }

        const res = await fetch(`/api/live-notes/${sessionId}/chat-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath: pathInfo.storagePath,
            fileName: file.name,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          fileName?: string;
          text?: string;
        };
        if (!res.ok || typeof body.text !== "string" || !body.text.trim()) {
          await supabase.storage
            .from(STUDY_PDF_INGEST_BUCKET)
            .remove([pathInfo.storagePath])
            .catch(() => {});
          setAttachError(body.error || `Could not read ${file.name}.`);
          return null;
        }
        extracted.push({
          fileName: (body.fileName ?? file.name).slice(0, 200),
          text: body.text.trim(),
        });
      }

      const prior = pendingPdfRef.current;
      const parts = [
        ...(prior ? [{ fileName: prior.fileName, text: prior.text }] : []),
        ...extracted,
      ];
      const per = Math.max(1_200, Math.floor(MAX_CHAT_PDF_CHARS / parts.length));
      const combined: PendingPdf = {
        fileName: parts.map((p) => p.fileName).join(", ").slice(0, 200),
        text: parts
          .map((p) => `### ${p.fileName}\n${p.text.slice(0, per)}`)
          .join("\n\n")
          .slice(0, MAX_CHAT_PDF_CHARS),
      };
      setPendingPdf(combined);
      setQueuedPdfs([]);
      return combined;
    } catch {
      setAttachError("Could not attach that PDF. Try again.");
      return null;
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attaching, busy, sessionId]);

  const send = useCallback(
    async (text: string) => {
      const typed = text.trim();
      if (busy || attaching) return;
      let pdf = pendingPdfRef.current;
      if (queuedPdfsRef.current.length > 0) {
        const attached = await confirmQueuedPdfs();
        if (!attached) return;
        pdf = attached;
      }
      if (!typed && !pdf) return;
      const message = typed || `Look at this PDF (${pdf!.fileName}).`;
      setDraft("");
      setBusy(true);

      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: "user",
        content: typed
          ? pdf
            ? `${typed}\n\n📎 ${pdf.fileName}`
            : typed
          : `📎 ${pdf!.fileName}`,
        attachmentName: pdf?.fileName,
      };
      const assistantId = `a-${Date.now()}`;
      const history = turnsRef.current
        .filter((t) => t.content.trim())
        .slice(-12)
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((prev) => [
        ...prev,
        userTurn,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStreamingId(assistantId);

      const writer = notesRef.current?.getStreamWriter();
      const sections = writer?.listAllSections(60) ?? [];
      const selectedText = notesRef.current?.getSelectedText() ?? "";
      const selectedSectionId =
        notesRef.current?.getSelectedSectionId() ?? "";
      const hasNotes = Boolean(writer && sections.length > 0);

      const noteOps: NoteOp[] = [];
      let appendStarted = false;
      let noteOpCount = 0;
      let pendingReply = "";
      let fallbackReply: string | null = null;
      let revealed = 0;
      let sseDone = false;
      let cancelled = false;
      const thoughtAcc: string[] = [];
      const seenThoughts = new Set<string>();

      const visibleSource = () =>
        fallbackReply ?? visibleReplyForStream(pendingReply, sseDone);

      const syncThoughts = () => {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, thoughts: [...thoughtAcc] } : t
          )
        );
      };

      const pushThought = (message: string, toActivity: boolean) => {
        const msg = message.trim();
        if (!msg || seenThoughts.has(msg)) return;
        seenThoughts.add(msg);
        thoughtAcc.push(msg);
        if (toActivity) onActivity("thought", msg);
        syncThoughts();
      };

      const harvestLeaks = () => {
        for (const leak of splitStudentFacingReply(pendingReply).leaked) {
          pushThought(leak, false);
        }
      };

      const revealReply = (next: string) => {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, content: next } : t
          )
        );
      };

      const pumpReply = async () => {
        while (!cancelled) {
          harvestLeaks();
          const source = visibleSource();
          if (revealed > source.length) {
            revealed = source.length;
            revealReply(source);
          }
          const leftover = source.slice(revealed);
          if (!leftover) {
            if (sseDone) break;
            await sleep(REPLY_TICK_MS);
            continue;
          }
          const cps =
            leftover.length > 320
              ? REPLY_CPS_CATCHUP
              : leftover.length > 90
                ? 110
                : REPLY_CPS;
          const step = Math.max(
            1,
            Math.round((cps * REPLY_TICK_MS) / 1000)
          );
          revealed += Math.min(step, leftover.length);
          revealReply(source.slice(0, revealed));
          await sleep(REPLY_TICK_MS);
        }
      };

      const pump = pumpReply();
      let failed = false;
      try {
        const res = await fetch(`/api/live-notes/${sessionId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            history,
            sections,
            transcript: recentTranscript || undefined,
            screenContext: screenContext || undefined,
            selectedText: selectedText || undefined,
            selectedSectionId: selectedSectionId || undefined,
            noteInstruction: noteInstructionRef.current,
            attachedPdfText: pdf?.text,
            attachedPdfName: pdf?.fileName,
          }),
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("text/event-stream")) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Could not reach Rose.");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Could not reach Rose.");
        const decoder = new TextDecoder();
        let buf = "";

        const handleEvent = (event: string, parsed: Record<string, unknown>) => {
          if (event === "thought") {
            if (typeof parsed.message === "string" && parsed.message.trim()) {
              pushThought(parsed.message, true);
            }
          } else if (event === "text") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : "";
            if (!delta) return;
            if (parsed.channel === "notes") {
              noteOps.push({ kind: "notes", text: delta });
            } else {
              pendingReply += delta;
            }
          } else if (event === "op") {
            const sectionId =
              typeof parsed.sectionId === "string" ? parsed.sectionId : "";
            if (!sectionId) return;
            if (parsed.op === "delete") {
              noteOps.push({ kind: "delete", sectionId });
              noteOpCount += 1;
            } else if (parsed.op === "highlight") {
              noteOps.push({
                kind: "highlight",
                sectionId,
                color:
                  typeof parsed.color === "string" ? parsed.color : "#fde68a",
              });
              noteOpCount += 1;
            } else if (parsed.op === "revise") {
              noteOps.push({ kind: "revise", sectionId });
              noteOpCount += 1;
            } else if (parsed.op === "append") {
              noteOps.push({
                kind: "append",
                sectionId,
                dividerBefore: hasNotes || appendStarted,
              });
              appendStarted = true;
              noteOpCount += 1;
            }
          } else if (event === "error") {
            throw new Error(
              typeof parsed.message === "string"
                ? parsed.message
                : "Could not answer just now."
            );
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sepIdx: number;
          while ((sepIdx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, sepIdx);
            buf = buf.slice(sepIdx + 2);
            let event = "message";
            let data = "";
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            handleEvent(event, JSON.parse(data) as Record<string, unknown>);
          }
        }

        harvestLeaks();
        if (!visibleReplyForStream(pendingReply, true).trim()) {
          fallbackReply = noteOpCount
            ? "Updated your notes."
            : "I didn't have a reply for that — try asking again.";
        }
      } catch (e) {
        failed = true;
        cancelled = true;
        const msg =
          e instanceof Error && e.message
            ? e.message
            : "Could not answer just now.";
        onActivity("error", msg);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, content: t.content.trim() || msg }
              : t
          )
        );
      } finally {
        sseDone = true;
        await pump;
        if (!failed) {
          harvestLeaks();
          const final = visibleSource();
          if (final.trim()) revealReply(final);
        }
        setStreamingId(null);
        setBusy(false);
        inputRef.current?.focus();
      }

      if (!failed && noteOps.length > 0) {
        onActivity(
          "status",
          noteOpCount === 1
            ? "Updating your notes from chat…"
            : "Applying those note edits…"
        );
        void applyNoteOps(
          noteOps,
          visibleReplyForStream(pendingReply, true)
        );
      } else if (!failed && looksLikeNoteEditRequest(message)) {
        const replyVisible = visibleReplyForStream(pendingReply, true);
        const replyNotes = sanitizeChatNotesMarkdown(replyVisible);
        const targetId =
          selectedSectionId || sections[sections.length - 1]?.sectionId || "";
        if (looksLikeNotesBody(replyNotes) && (wantsAppendToNotes(message) || targetId)) {
          const appendId = `s-${crypto.randomUUID().slice(0, 8)}`;
          if (wantsAppendToNotes(message) || !targetId) {
            void applyNoteOps(
              [
                {
                  kind: "append",
                  sectionId: appendId,
                  dividerBefore: hasNotes || appendStarted,
                },
                { kind: "notes", text: `${replyNotes}\n` },
              ],
              ""
            );
          } else {
            void applyNoteOps(
              [
                { kind: "revise", sectionId: targetId },
                { kind: "notes", text: `${replyNotes}\n` },
              ],
              ""
            );
          }
          if (
            /^#{1,3}\s/m.test(replyVisible.trim()) ||
            /^\s*[-*]\s/m.test(replyVisible.trim())
          ) {
            revealReply("Updated your notes.");
          }
        } else {
          onActivity(
            "error",
            "I didn't apply that to the notes. Try again, or select the section first."
          );
        }
      }
    },
    [
      applyNoteOps,
      attaching,
      busy,
      confirmQueuedPdfs,
      notesRef,
      onActivity,
      recentTranscript,
      screenContext,
      sessionId,
    ]
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Ask about this lecture, drop a PDF (worksheet, problem set), or
              tell Rose to edit the notes.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || attaching}
                  onClick={() => void send(s)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t) => (
            <div
              key={t.id}
              className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div className="max-w-[92%]">
                <div
                  className={
                    t.role === "user"
                      ? "rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[12px] leading-snug text-white"
                      : "rounded-xl rounded-bl-sm border border-fuchsia-200/55 bg-fuchsia-50/90 px-3 py-2 text-[12px] leading-snug text-zinc-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/40 dark:text-zinc-100"
                  }
                >
                  <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">
                    {t.role === "user" ? "You" : "Rose"}
                    {t.id === streamingId ? " · …" : ""}
                  </p>
                  {t.role === "assistant" ? (
                    <div className="text-[12px] leading-snug">
                      {t.content.trim() ? (
                        <StudyChatMessageMarkdown source={t.content} compact />
                      ) : null}
                      {t.id === streamingId ? (
                        <span
                          aria-hidden
                          className="ml-0.5 inline-block h-[0.85em] w-[0.08em] translate-y-[0.12em] animate-pulse rounded-sm bg-fuchsia-500 align-baseline"
                        />
                      ) : null}
                    </div>
                  ) : t.content.trim() ? (
                    <p className="whitespace-pre-wrap text-[12px] leading-snug">
                      {t.content}
                    </p>
                  ) : null}
                </div>
                {t.role === "assistant" &&
                (t.thoughts?.length ?? 0) > 0 ? (
                  <details className="mt-1 px-0.5">
                    <summary className="cursor-pointer select-none text-[10px] font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                      Thinking…
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t.thoughts!.join("\n")}
                    </p>
                  </details>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div aria-hidden className="h-px w-full" />
      </div>

      <form
        onSubmit={onSubmit}
        onDragEnter={(e) => {
          e.preventDefault();
          if (busy || attaching) return;
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (busy || attaching) return;
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          queuePdfs(e.dataTransfer.files);
        }}
        className={`border-t p-2.5 dark:border-zinc-800 ${
          dragOver
            ? "border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/30"
            : "border-zinc-200"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="sr-only"
          disabled={busy || attaching}
          onChange={(e) => {
            queuePdfs(e.target.files ?? undefined);
          }}
        />
        {queuedPdfs.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {queuedPdfs.map((file) => (
              <span
                key={pdfFileKey(file)}
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-dashed border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <span className="truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  disabled={busy || attaching}
                  onClick={() =>
                    setQueuedPdfs((prev) =>
                      prev.filter((f) => pdfFileKey(f) !== pdfFileKey(file))
                    )
                  }
                  className="ml-0.5 shrink-0 rounded-full px-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200"
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              disabled={busy || attaching}
              onClick={() => void confirmQueuedPdfs()}
              className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[10px] font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              {queuedPdfs.length === 1
                ? "Confirm PDF"
                : `Confirm ${queuedPdfs.length} PDFs`}
            </button>
          </div>
        ) : null}
        {pendingPdf ? (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              <span className="truncate" title={pendingPdf.fileName}>
                📎 {pendingPdf.fileName}
              </span>
              <button
                type="button"
                disabled={busy || attaching}
                onClick={() => {
                  setPendingPdf(null);
                  setAttachError(null);
                }}
                className="ml-0.5 shrink-0 rounded-full px-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200"
                aria-label="Remove PDF"
              >
                ×
              </button>
            </span>
          </div>
        ) : null}
        {attachError ? (
          <p className="mb-1.5 text-[10px] leading-snug text-red-600 dark:text-red-400">
            {attachError}
          </p>
        ) : null}
        <label className="sr-only" htmlFor="live-notes-chat-input">
          Ask Rose about the lecture
        </label>
        <textarea
          id="live-notes-chat-input"
          ref={inputRef}
          rows={2}
          value={draft}
          disabled={busy || attaching}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={
            pendingPdf
              ? `Ask about ${pendingPdf.fileName}…`
              : lectureTitle.trim()
                ? `Ask about ${lectureTitle.trim()}…`
                : "Ask about the lecture, attach a PDF, or edit the notes…"
          }
          className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-rose-800 dark:focus:ring-rose-950/80"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              disabled={busy || attaching}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a PDF"
              title="Attach a PDF"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-rose-800 dark:hover:text-rose-300"
            >
              {attaching ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>
            <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
              {attaching
                ? queuedPdfs.length > 1
                  ? "Reading PDFs…"
                  : "Reading PDF…"
                : dragOver
                  ? "Drop PDFs to add"
                  : queuedPdfs.length > 0
                    ? "Add more, then confirm"
                    : "PDF · Enter to send"}
            </p>
          </div>
          <button
            type="submit"
            disabled={
              busy ||
              attaching ||
              (!draft.trim() && !pendingPdf && queuedPdfs.length === 0)
            }
            className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy
              ? turns.some((t) => t.id === streamingId && t.content)
                ? "Writing…"
                : "Thinking…"
              : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
