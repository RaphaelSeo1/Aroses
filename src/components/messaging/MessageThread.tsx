"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ConversationSidebar } from "@/components/messaging/ConversationSidebar";
import {
  dispatchMessagingRefresh,
  mapDbMessageToRow,
  type DbMessageRow,
} from "@/lib/messaging/realtime";
import type { ConversationMember, MessageRow } from "@/lib/messaging/types";
import { createClient } from "@/lib/supabase/client";

type Props = {
  conversationId: string;
  title: string;
  courseId?: string | null;
  courseTitle?: string | null;
  isGroup?: boolean;
  members?: ConversationMember[];
  onBack?: () => void;
  embedded?: boolean;
};

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageThreadInner({
  conversationId,
  title,
  courseId,
  courseTitle,
  isGroup,
  members = [],
  onBack,
  embedded = false,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachContext, setAttachContext] = useState(false);
  const [contextMaterialId, setContextMaterialId] = useState("");
  const [contextModuleId, setContextModuleId] = useState("");
  const [contextLessonIndex, setContextLessonIndex] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const initialScrollDone = useRef(false);

  const markRead = useCallback(async () => {
    await fetch(`/api/conversations/${conversationId}/read`, { method: "PATCH" });
    dispatchMessagingRefresh();
  }, [conversationId]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessages(body.messages ?? []);
        await markRead();
      }
    } catch {
      /* ignore fetch errors */
    }
    setLoading(false);
  }, [conversationId, markRead]);

  useEffect(() => {
    let cancelled = false;
    let removeChannel: (() => void) | undefined;
    const supabase = createClient();

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      await loadMessages();

      const channel = supabase
        .channel(`thread:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const row = payload.new as DbMessageRow;
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              return [...prev, mapDbMessageToRow(row, user.id)];
            });
            if (row.sender_id !== user.id) {
              void markRead();
            }
            dispatchMessagingRefresh();
          }
        )
        .subscribe();

      removeChannel = () => {
        void supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
    };
  }, [conversationId, loadMessages, markRead]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      scrollToBottom("auto");
      return;
    }
    if (atBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [messages, loading, scrollToBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);

    const payload: Record<string, unknown> = { body: text };
    if (attachContext && courseId) {
      payload.courseId = courseId;
      if (contextMaterialId.trim()) payload.materialId = contextMaterialId.trim();
      if (contextModuleId.trim()) payload.moduleId = Number.parseInt(contextModuleId, 10);
      if (contextLessonIndex.trim()) payload.lessonIndex = Number.parseInt(contextLessonIndex, 10);
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not send.");
      } else if (body.message) {
        const msg = body.message as MessageRow;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        setDraft("");
        atBottomRef.current = true;
        dispatchMessagingRefresh();
      }
    } catch {
      setError("Network error.");
    }
    setSending(false);
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const shellClass = embedded
    ? "flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950"
    : "flex min-h-[calc(100vh-12rem)] flex-col rounded-3xl border border-zinc-200/90 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950";

  return (
    <div className={`${shellClass} lg:flex-row`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800 sm:px-5">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 text-sm text-zinc-500 hover:text-zinc-800 sm:hidden dark:hover:text-zinc-200"
            >
              ←
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push("/messages")}
              className="shrink-0 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              ← Inbox
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {title}
            </h1>
            {isGroup ? (
              <p className="truncate text-xs text-zinc-500">
                {members.length} {members.length === 1 ? "member" : "members"}
                {courseTitle ? ` · ${courseTitle}` : ""}
              </p>
            ) : null}
          </div>
          {courseId && !embedded ? (
            <Link
              href={`/dashboard/courses/${courseId}`}
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              Course
            </Link>
          ) : null}
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
        >
          {loading ? (
            <p className="text-center text-sm text-zinc-400">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">
              Say hello — your messages stay private between participants.
            </p>
          ) : (
            <ul className="space-y-4">
              {messages.map((m) => {
                const member = members.find((p) => p.id === m.senderId);
                const name =
                  m.senderDisplayName ??
                  (m.senderUsername ? `@${m.senderUsername}` : "User");

                if (isGroup && !m.isOwn) {
                  return (
                    <li key={m.id} className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {member?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={member.avatarUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          name.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 max-w-[85%]">
                        <div className="mb-1 flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {name}
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            {formatMessageTime(m.createdAt)}
                          </span>
                        </div>
                        {m.contextLabel ? (
                          <p className="mb-1.5 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            Re: {m.contextLabel}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
                          {m.body}
                        </p>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={m.id} className={`flex ${m.isOwn ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        m.isOwn
                          ? "bg-brand text-white"
                          : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                      }`}
                    >
                      {m.contextLabel ? (
                        <p
                          className={`mb-2 rounded-lg px-2 py-1 text-[11px] ${
                            m.isOwn ? "bg-white/15" : "bg-white/60 dark:bg-zinc-900/60"
                          }`}
                        >
                          Re: {m.contextLabel}
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          m.isOwn ? "text-white/70" : "text-zinc-500"
                        }`}
                      >
                        {formatMessageTime(m.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={bottomRef} />
        </div>

        <footer className="shrink-0 border-t border-zinc-100 p-3 dark:border-zinc-800 sm:px-5 sm:py-4">
          {courseId ? (
            <label className="mb-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={attachContext}
                onChange={(e) => setAttachContext(e.target.checked)}
              />
              Attach lesson context
            </label>
          ) : null}
          {attachContext && courseId ? (
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <input
                value={contextMaterialId}
                onChange={(e) => setContextMaterialId(e.target.value)}
                placeholder="Material ID"
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <input
                value={contextModuleId}
                onChange={(e) => setContextModuleId(e.target.value)}
                placeholder="Module #"
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <input
                value={contextLessonIndex}
                onChange={(e) => setContextLessonIndex(e.target.value)}
                placeholder="Lesson #"
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          ) : null}
          {error ? (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <form onSubmit={(e) => void send(e)} className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={1}
              placeholder="Message…"
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-50"
              aria-label="Send message"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
              </svg>
            </button>
          </form>
          <p className="mt-2 text-[10px] text-zinc-400">
            Enter to send · Shift+Enter for newline
          </p>
        </footer>
      </div>

      {members.length > 0 ? (
        <ConversationSidebar
          title={title}
          isGroup={!!isGroup}
          members={members}
          courseId={courseId}
          courseTitle={courseTitle}
        />
      ) : null}
    </div>
  );
}

export const MessageThread = memo(MessageThreadInner);
