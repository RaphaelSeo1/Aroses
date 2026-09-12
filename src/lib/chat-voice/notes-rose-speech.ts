import { speakableText } from "./speakable-text.ts";

/** Same shape the mentored / converse tutor uses for barge-in. */
export type NotesRoseInterruptHint = {
  spokenBeforeInterrupt: string;
  notYetSpoken: string;
  streamIncomplete?: boolean;
};

const SENTENCE_TERMINATORS = ".!?。！？";
const CLOSING_PUNCTUATION = "\"')]}”’」』）〉》";

/**
 * Pull the next speakable chunk off a streaming buffer. Matches the
 * VoiceTutorDock heuristic: prefer 1–2 complete sentences so TTS can start
 * before the model finishes, without chopping decimals ("3.14").
 */
export function takeNaturalVoiceChunk(
  text: string,
  final: boolean
): { chunk: string | null; rest: string } {
  if (!text.trim()) return { chunk: null, rest: "" };

  let lastBoundary = -1;
  let sentenceCount = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!SENTENCE_TERMINATORS.includes(text[i] ?? "")) continue;
    let end = i + 1;
    while (end < text.length && CLOSING_PUNCTUATION.includes(text[end] ?? "")) {
      end += 1;
    }
    const next = text[end];
    if (next && !/\s/.test(next)) continue;
    lastBoundary = end;
    sentenceCount += 1;
    if (sentenceCount >= 2 || end >= 180) break;
  }

  if (lastBoundary > 0) {
    return {
      chunk: text.slice(0, lastBoundary),
      rest: text.slice(lastBoundary).replace(/^\s+/, ""),
    };
  }

  if (text.length >= 360) {
    const softBreaks = [", ", "; ", ": ", " — ", " and ", " but ", " so "];
    let cut = -1;
    for (const marker of softBreaks) {
      cut = Math.max(cut, text.lastIndexOf(marker, 300));
    }
    if (cut > 140) {
      const end = cut + 1;
      return {
        chunk: text.slice(0, end),
        rest: text.slice(end).replace(/^\s+/, ""),
      };
    }
  }

  if (final) return { chunk: text, rest: "" };
  return { chunk: null, rest: text };
}

export function splitReplyIntoVoiceChunks(text: string): string[] {
  let rest = speakableText(text);
  const chunks: string[] = [];
  while (rest.trim()) {
    const next = takeNaturalVoiceChunk(rest, false);
    if (next.chunk?.trim()) {
      chunks.push(speakableText(next.chunk));
      rest = next.rest;
      continue;
    }
    const tail = takeNaturalVoiceChunk(rest, true);
    if (tail.chunk?.trim()) chunks.push(speakableText(tail.chunk));
    break;
  }
  return chunks.filter(Boolean);
}

/** Incremental reply → TTS chunks, plus spoken vs leftover for barge-in. */
export class StreamingSpeechBuffer {
  private buf = "";
  generated = "";
  spoken = "";

  pushDelta(delta: string): string[] {
    if (!delta) return [];
    this.generated += delta;
    this.buf += delta;
    const out: string[] = [];
    while (true) {
      const { chunk, rest } = takeNaturalVoiceChunk(this.buf, false);
      if (!chunk) break;
      const spoken = speakableText(chunk);
      if (spoken) out.push(spoken);
      this.buf = rest;
    }
    return out;
  }

  flush(): string | null {
    const { chunk, rest } = takeNaturalVoiceChunk(this.buf, true);
    this.buf = rest;
    const spoken = chunk ? speakableText(chunk) : "";
    return spoken || null;
  }

  markSpoken(chunk: string) {
    const next = chunk.trim();
    if (!next) return;
    this.spoken = `${this.spoken} ${next}`.trim();
  }

  interruptHint(streamIncomplete = true): NotesRoseInterruptHint {
    const spoken = this.spoken.trim();
    const full = speakableText(this.generated);
    let notYet = "";
    if (spoken && full.startsWith(spoken)) {
      notYet = full.slice(spoken.length).trim();
    } else if (spoken) {
      const idx = full.indexOf(spoken);
      notYet = idx >= 0 ? full.slice(idx + spoken.length).trim() : speakableText(this.buf);
    } else {
      notYet = full;
    }
    return {
      spokenBeforeInterrupt: spoken,
      notYetSpoken: notYet,
      streamIncomplete,
    };
  }
}

export type AsyncSentenceQueue = {
  readonly closed: boolean;
  push: (sentence: string) => boolean;
  close: () => void;
  [Symbol.asyncIterator]: () => AsyncGenerator<string, void, void>;
};

/** Producer/consumer queue for speakSentenceStream. close() drops unplayed items. */
export function createAsyncSentenceQueue(): AsyncSentenceQueue {
  const items: string[] = [];
  const waiters: Array<(result: IteratorResult<string>) => void> = [];
  let closed = false;

  return {
    get closed() {
      return closed;
    },
    push(sentence: string) {
      if (closed) return false;
      const next = sentence.trim();
      if (!next) return false;
      const waiter = waiters.shift();
      if (waiter) waiter({ value: next, done: false });
      else items.push(next);
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      items.length = 0;
      while (waiters.length > 0) {
        waiters.shift()!({ value: undefined as never, done: true });
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length > 0) {
          yield items.shift()!;
          continue;
        }
        if (closed) return;
        const next = await new Promise<IteratorResult<string>>((resolve) => {
          waiters.push(resolve);
        });
        if (next.done) return;
        yield next.value;
      }
    },
  };
}

/**
 * Stop in-flight notes Rose speech the same way the mentored tutor does:
 * drop queued sentences, abort the chat turn, cancel TTS.
 */
export function cancelInFlightNotesRoseSpeech(input: {
  queue: Pick<AsyncSentenceQueue, "close">;
  abortTurn: () => void;
  cancelSpeak: () => void;
}): void {
  input.queue.close();
  input.abortTurn();
  input.cancelSpeak();
}
