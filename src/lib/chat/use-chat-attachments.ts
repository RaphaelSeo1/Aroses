"use client";

import { useCallback, useRef, useState } from "react";
import {
  CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE,
  chatFileKey,
  MAX_CHAT_ATTACHMENTS,
  queueChatAttachmentFiles,
} from "@/lib/chat/chat-attachment-formats";
import {
  extractQueuedChatFiles,
  mergeExtractedChatAttachments,
  type ExtractedChatAttachment,
} from "@/lib/chat/extract-queued-chat-files";

export type PendingChatAttachment = ExtractedChatAttachment;

export function useChatAttachments(
  opts: {
    disabled?: boolean;
    initialPending?: PendingChatAttachment | null;
  } = {}
) {
  const disabled = Boolean(opts.disabled);
  const [queued, setQueued] = useState<File[]>([]);
  const [pending, setPending] = useState<PendingChatAttachment | null>(
    opts.initialPending ?? null
  );
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const queueFiles = useCallback(
    (list: FileList | File[] | undefined) => {
      if (disabled || attaching) return;
      const incoming = Array.from(list ?? []);
      if (incoming.length === 0) return;
      setAttachError(null);
      const result = queueChatAttachmentFiles({
        incoming,
        alreadyQueued: queuedRef.current,
        maxCount: MAX_CHAT_ATTACHMENTS,
      });
      setQueued(result.nextQueued);
      if (result.error) setAttachError(result.error);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [attaching, disabled]
  );

  const removeQueued = useCallback((file: File) => {
    setQueued((prev) =>
      prev.filter((f) => chatFileKey(f) !== chatFileKey(file))
    );
  }, []);

  const confirmQueued = useCallback(async (): Promise<PendingChatAttachment | null> => {
    const current = queuedRef.current;
    if (current.length === 0 || disabled || attaching) {
      return pendingRef.current;
    }
    setAttachError(null);
    setAttaching(true);
    try {
      const result = await extractQueuedChatFiles({ files: current });
      if (!result.ok) {
        setAttachError(result.error);
        return null;
      }
      const prior = pendingRef.current;
      const combined = prior
        ? mergeExtractedChatAttachments([
            { fileName: prior.fileName, text: prior.text },
            ...result.parts,
          ])
        : result.combined;
      setPending(combined);
      setQueued([]);
      return combined;
    } catch {
      setAttachError("Could not attach that file. Try again.");
      return null;
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attaching, disabled]);

  const takePendingForSend = useCallback(async (): Promise<PendingChatAttachment | null> => {
    if (disabled || attaching) return null;
    if (queuedRef.current.length > 0) {
      return confirmQueued();
    }
    return pendingRef.current;
  }, [attaching, confirmQueued, disabled]);

  const clearPending = useCallback(() => {
    setPending(null);
    setAttachError(null);
  }, []);

  const onDragEnter = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      if (disabled || attaching) return;
      setDragOver(true);
    },
    [attaching, disabled]
  );

  const onDragOver = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      if (disabled || attaching) return;
      setDragOver(true);
    },
    [attaching, disabled]
  );

  const onDragLeave = useCallback(
    (e: {
      preventDefault: () => void;
      currentTarget: EventTarget;
      relatedTarget: EventTarget | null;
    }) => {
      e.preventDefault();
      if (
        e.currentTarget instanceof Node &&
        e.relatedTarget instanceof Node &&
        e.currentTarget.contains(e.relatedTarget)
      ) {
        return;
      }
      setDragOver(false);
    },
    []
  );

  const onDrop = useCallback(
    (e: { preventDefault: () => void; dataTransfer: DataTransfer | null }) => {
      e.preventDefault();
      setDragOver(false);
      queueFiles(e.dataTransfer?.files);
    },
    [queueFiles]
  );

  const hasAttachment =
    Boolean(pending) || queued.length > 0;

  return {
    queued,
    pending,
    attaching,
    attachError,
    dragOver,
    hasAttachment,
    fileInputRef,
    accept: CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE,
    queueFiles,
    removeQueued,
    confirmQueued,
    takePendingForSend,
    clearPending,
    setPending,
    setAttachError,
    pendingRef,
    queuedRef,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
