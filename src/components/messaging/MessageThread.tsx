"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  dispatchMessagingRefresh,
  mapDbMessageToRow,
  type DbMessageRow,
} from "@/lib/messaging/realtime";
import type { ConversationMember, MessageRow } from "@/lib/messaging/types";
import { createClient } from "@/lib/supabase/client";
import { GroupMembersPanel } from "@/components/messaging/GroupMembersPanel";

type Props = {
  conversationId: string;
  title: string;
  courseId?: string | null;
  isGroup?: boolean;
  members?: ConversationMember[];
  onBack?: () => void;
};

export function MessageThread({
  conversationId,
  title,
  courseId,
  isGroup,
  members = [],
  onBack,
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
  const bottomRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
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
        dispatchMessagingRefresh();
      }
    } catch {
      setError("Network error.");
    }
    setSending(false);
  }

  return (
    <div className={`flex flex-col rounded-3xl border border-zinc-200/90 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 ${onBack ? "min-h-[28rem]" : "min-h-[calc(100vh-12rem)]"}`}>
      <header className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800 sm:px-6">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : router.push("/messages"))}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Inbox
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
          {isGroup ? (
            <p className="text-xs text-zinc-500">
              Group chat
              {members.length > 0 ? ` · ${members.length} members` : ""}
            </p>
          ) : null}
        </div>
        {courseId ? (
          <Link
            href={`/dashboard/courses/${courseId}`}
            className="shrink-0 text-xs font-medium text-brand hover:underline"
          >
            Open course
          </Link>
        ) : null}
      </header>

      {isGroup && members.length > 0 ? <GroupMembersPanel members={members} /> : null}

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loading ? (
          <p className="text-center text-sm text-zinc-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">Say hello — your messages stay private between participants.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const name =
                m.senderDisplayName ??
                (m.senderUsername ? `@${m.senderUsername}` : "User");
              return (
                <li
                  key={m.id}
                  className={`flex ${m.isOwn ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.isOwn
                        ? "bg-brand text-white"
                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    {!m.isOwn && isGroup ? (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                        {name}
                      </p>
                    ) : null}
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
                      {new Date(m.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-zinc-100 p-4 dark:border-zinc-800 sm:px-6">
        {courseId ? (
          <label className="mb-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={attachContext}
              onChange={(e) => setAttachContext(e.target.checked)}
            />
            Attach lesson context to this message
          </label>
        ) : null}
        {attachContext && courseId ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <input
              value={contextMaterialId}
              onChange={(e) => setContextMaterialId(e.target.value)}
              placeholder="Material ID (optional)"
              className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              value={contextModuleId}
              onChange={(e) => setContextModuleId(e.target.value)}
              placeholder="Module # (0-based)"
              className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              value={contextLessonIndex}
              onChange={(e) => setContextLessonIndex(e.target.value)}
              placeholder="Lesson # (0-based)"
              className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        ) : null}
        {error ? (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <form onSubmit={(e) => void send(e)} className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Write a message…"
            className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="shrink-0 self-end rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>
        </form>
      </footer>
    </div>
  );
}
