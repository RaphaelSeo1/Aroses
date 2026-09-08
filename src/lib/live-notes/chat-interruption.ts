export type ChatRequestLease = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
};

type ActiveRequest = {
  controller: AbortController;
  generation: number;
  settled: Promise<void>;
  resolveSettled: () => void;
};

/**
 * Owns the single active notes-chat request. A replacement send aborts the
 * current request immediately, waits for its finalizer, and then receives a
 * fresh lease. The synchronous accepting guard drops button/Enter double
 * submits before React state has time to update.
 */
export class NotesChatInterruptionCoordinator {
  private active: ActiveRequest | null = null;
  private accepting = false;
  private generation = 0;

  get isActive(): boolean {
    return this.active !== null;
  }

  async beginSend(onInterrupt?: () => void): Promise<ChatRequestLease | null> {
    if (this.accepting) return null;
    this.accepting = true;

    try {
      const previous = this.active;
      if (previous) {
        this.generation += 1;
        onInterrupt?.();
        previous.controller.abort();
        await previous.settled;
      }

      const generation = ++this.generation;
      const controller = new AbortController();
      let resolveSettled = () => {};
      const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
      });
      const active: ActiveRequest = {
        controller,
        generation,
        settled,
        resolveSettled,
      };
      this.active = active;

      let finished = false;
      return {
        signal: controller.signal,
        isCurrent: () => this.generation === generation,
        finish: () => {
          if (finished) return;
          finished = true;
          if (this.active === active) this.active = null;
          resolveSettled();
        },
      };
    } finally {
      this.accepting = false;
    }
  }

  async stop(onStop?: () => void): Promise<boolean> {
    const active = this.active;
    if (!active) return false;
    this.generation += 1;
    onStop?.();
    active.controller.abort();
    await active.settled;
    return true;
  }
}

export type NotesChatHistoryTurn = {
  role: "user" | "assistant";
  content: string;
  interrupted?: boolean | "send" | "stop";
};

/** Build model history while preserving why a partial assistant turn ended. */
export function buildNotesChatHistory(
  turns: NotesChatHistoryTurn[],
  limit = 12
): Array<{ role: "user" | "assistant"; content: string }> {
  return turns
    .filter((turn) => turn.content.trim() || turn.interrupted)
    .slice(-limit)
    .map((turn) => {
      if (!turn.interrupted) {
        return { role: turn.role, content: turn.content };
      }
      const partial = turn.content.trim();
      const marker =
        turn.interrupted === "stop"
          ? "Response stopped by the student"
          : "Response interrupted by the student";
      return {
        role: turn.role,
        content: partial
          ? `[${marker}]\n${partial}`
          : `[${marker} before any reply text was shown]`,
      };
    });
}
