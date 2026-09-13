export type ReviewChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  interrupted?: "send" | "stop";
};

export type ReviewChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  turns: ReviewChatTurn[];
};

const MAX_THREADS = 20;
const MAX_TURNS = 40;

function storageKey(sessionKey: string) {
  return `aroses.reviewChat.threads.${sessionKey}`;
}

function parseTurn(raw: unknown): ReviewChatTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (
    (t.role !== "user" && t.role !== "assistant") ||
    typeof t.content !== "string" ||
    typeof t.id !== "string"
  ) {
    return null;
  }
  return {
    id: t.id,
    role: t.role,
    content: t.content,
    interrupted:
      t.interrupted === "stop"
        ? "stop"
        : t.interrupted === "send"
          ? "send"
          : undefined,
  };
}

export function loadReviewChatThreads(sessionKey: string): ReviewChatThread[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ReviewChatThread | null => {
        if (!item || typeof item !== "object") return null;
        const t = item as Record<string, unknown>;
        if (typeof t.id !== "string" || typeof t.title !== "string") return null;
        const turns = Array.isArray(t.turns)
          ? t.turns.map(parseTurn).filter((x): x is ReviewChatTurn => Boolean(x))
          : [];
        return {
          id: t.id,
          title: t.title.trim().slice(0, 80) || "Chat",
          updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : 0,
          turns: turns.slice(-MAX_TURNS),
        };
      })
      .filter((x): x is ReviewChatThread => Boolean(x))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

export function saveReviewChatThreads(
  sessionKey: string,
  threads: ReviewChatThread[]
) {
  try {
    localStorage.setItem(
      storageKey(sessionKey),
      JSON.stringify(
        threads
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_THREADS)
          .map((t) => ({
            ...t,
            title: t.title.slice(0, 80),
            turns: t.turns.filter((x) => x.content.trim()).slice(-MAX_TURNS),
          }))
      )
    );
  } catch {
    /* quota / private mode */
  }
}

export function threadTitleFromTurns(turns: ReviewChatTurn[]): string {
  const first = turns.find((t) => t.role === "user" && t.content.trim());
  if (!first) return "New chat";
  const line = first.content.replace(/\s+/g, " ").trim();
  return line.length > 42 ? `${line.slice(0, 40)}…` : line;
}
