"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { typewriteKnownText } from "@/lib/chat/typewriter-pump";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import { useT } from "@/lib/i18n/LocaleProvider";
import { describePdfIngestUploadFailure } from "@/lib/storage-upload-errors";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import { detectIngestFormat, MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createClient } from "@/lib/supabase/client";
import type { CalendarItem } from "@/types/calendar";

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachmentName?: string;
};

type PendingPdf = { fileName: string; text: string };

const MAX_CHAT_PDFS = 5;
const MAX_CHAT_PDF_CHARS = 16_000;

function pdfFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function CalendarRoseChat({
  onItems,
  autoFocus = false,
}: {
  onItems: (items: CalendarItem[]) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPdf, setPendingPdf] = useState<PendingPdf | null>(null);
  const [queuedPdfs, setQueuedPdfs] = useState<File[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPdfRef = useRef(pendingPdf);
  pendingPdfRef.current = pendingPdf;
  const queuedPdfsRef = useRef(queuedPdfs);
  queuedPdfsRef.current = queuedPdfs;

  useEffect(() => {
    try {
      sessionStorage.removeItem("aroses.calendar.chat");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const queuePdfs = useCallback(
    (list: FileList | File[] | undefined) => {
      if (busy || attaching) return;
      const incoming = Array.from(list ?? []);
      if (incoming.length === 0) return;
      setAttachError(null);
      const accepted: File[] = [];
      let skippedType = 0;
      let skippedSize = 0;
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
        setAttachError(skippedSize > 0 ? t.calendar.pdfTooLarge : t.calendar.onlyPdfs);
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
        setAttachError(t.calendar.pdfMaxCount);
      } else if (skippedType > 0 || skippedSize > 0) {
        setAttachError(
          skippedSize > 0 ? t.calendar.pdfTooLarge : t.calendar.onlyPdfs
        );
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [attaching, busy, t.calendar]
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
        setAttachError(t.calendar.signInToUpload);
        return null;
      }

      const extracted: PendingPdf[] = [];
      for (const file of queued) {
        const pathInfo = ingestStoragePathForFile(user.id, file);
        if (!pathInfo) {
          setAttachError(t.calendar.onlyPdfs);
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

        const res = await fetch("/api/calendar/chat-pdf", {
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
          setAttachError(body.error || t.calendar.pdfAttachFailed);
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
      setAttachError(t.calendar.pdfAttachFailed);
      return null;
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attaching, busy, t.calendar]);

  const send = async (text: string) => {
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
    const userTurn: Turn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: typed
        ? pdf
          ? `${typed}\n\n📎 ${pdf.fileName}`
          : typed
        : `📎 ${pdf!.fileName}`,
      attachmentName: pdf?.fileName,
    };
    const history = [...turns, userTurn]
      .filter((x) => x.content.trim())
      .slice(-12)
      .map((x) => ({ role: x.role, content: x.content }));
    const assistantId = `a-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      userTurn,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    const revealReply = (next: string) => {
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === assistantId ? { ...turn, content: next } : turn
        )
      );
    };

    try {
      const res = await fetch("/api/calendar/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: history.slice(0, -1),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          nowIso: new Date().toISOString(),
          attachedPdfText: pdf?.text,
          attachedPdfName: pdf?.fileName,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        items?: CalendarItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t.calendar.roseError);
      if (Array.isArray(data.items)) onItems(data.items);
      const reply = data.reply?.trim() || t.calendar.roseEmpty;
      await typewriteKnownText(reply, revealReply);
    } catch (e) {
      revealReply(
        e instanceof Error && e.message ? e.message : t.calendar.roseError
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  const suggestions = [
    t.calendar.suggestionDue,
    t.calendar.suggestionAdd,
    t.calendar.suggestionClear,
  ];
  const canSend =
    !busy &&
    !attaching &&
    (Boolean(draft.trim()) || Boolean(pendingPdf) || queuedPdfs.length > 0);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <header className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t.calendar.roseTitle}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {t.calendar.roseHint}
        </p>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {turns.length === 0 && !busy ? (
          <div>
            <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {t.calendar.roseEmpty}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className={
                turn.role === "user"
                  ? "ml-6 rounded-2xl bg-brand-blush/70 px-3 py-2 text-[13px] text-brand-ink dark:bg-brand-blush/15 dark:text-brand-soft"
                  : "mr-4 text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-100"
              }
            >
              {turn.role === "assistant" ? (
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {AI_ASSISTANT_NAME}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </div>
          ))
        )}
        {busy && turns[turns.length - 1]?.content === "" ? (
          <p className="text-[12px] text-zinc-400">{AI_ASSISTANT_NAME}…</p>
        ) : null}
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
        className={`border-t p-3 dark:border-zinc-800 ${
          dragOver
            ? "border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/30"
            : "border-zinc-100"
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
                  aria-label={`${t.calendar.removePdf} ${file.name}`}
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
                ? t.calendar.confirmPdf
                : t.calendar.confirmPdfs}
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
                aria-label={t.calendar.removePdf}
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
        <textarea
          ref={inputRef}
          value={draft}
          disabled={busy || attaching}
          onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={2}
          placeholder={
            pendingPdf ? t.calendar.askAboutPdf : t.calendar.rosePlaceholder
          }
          className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              disabled={busy || attaching}
              onClick={() => fileInputRef.current?.click()}
              aria-label={t.calendar.attachPdf}
              title={t.calendar.attachPdf}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 hover:border-brand hover:text-brand disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
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
                  ? t.calendar.readingPdfs
                  : t.calendar.readingPdf
                : dragOver
                  ? t.calendar.dropPdfs
                  : queuedPdfs.length > 0
                    ? t.calendar.addMoreThenConfirm
                    : t.calendar.pdfEnterToSend}
            </p>
          </div>
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover disabled:opacity-40"
          >
            {t.calendar.askRose}
          </button>
        </div>
      </form>
    </section>
  );
}
