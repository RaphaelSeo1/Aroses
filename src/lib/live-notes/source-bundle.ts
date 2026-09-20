import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalNoteSourceBundle } from "@/lib/live-notes/canonical-synthesis";
import {
  formatDeckPages,
  loadSessionDeckPages,
} from "@/lib/live-notes/slide-pages";

const MAX_CANONICAL_DECK_CHARS = 400_000;
const MAX_CANONICAL_TRANSCRIPT_CHARS = 250_000;
const MAX_CANONICAL_SCREEN_CHARS = 80_000;
const MAX_CANONICAL_MATERIAL_CHARS = 80_000;

function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export async function loadCanonicalLiveNoteSources(
  supabase: SupabaseClient,
  sessionId: string
): Promise<CanonicalNoteSourceBundle> {
  const [segmentsResult, deckPages, sessionResult] = await Promise.all([
    supabase
      .from("live_lecture_segments")
      .select("seq, text, at_ms")
      .eq("session_id", sessionId)
      .order("seq", { ascending: true })
      .limit(5_001),
    loadSessionDeckPages(supabase, sessionId),
    supabase
      .from("live_lecture_sessions")
      .select("slides_page_count")
      .eq("id", sessionId)
      .maybeSingle(),
  ]);

  const incompleteReasons: string[] = [];
  if (segmentsResult.error) {
    incompleteReasons.push("transcript query failed");
  }
  if ((segmentsResult.data?.length ?? 0) > 5_000) {
    incompleteReasons.push("transcript segment limit exceeded");
  }
  const rawTranscript = (segmentsResult.data ?? [])
    .slice(0, 5_000)
    .map(
      (segment) =>
        `[${formatTimestamp(Number(segment.at_ms) || 0)}] ${String(segment.text ?? "").trim()}`
    )
    .filter((line) => line.trim().length > 8)
    .join("\n");
  if (rawTranscript.length > MAX_CANONICAL_TRANSCRIPT_CHARS) {
    incompleteReasons.push("transcript character limit exceeded");
  }
  const transcript = rawTranscript.slice(0, MAX_CANONICAL_TRANSCRIPT_CHARS);

  if (sessionResult.error) {
    incompleteReasons.push("session source metadata query failed");
  }
  const expectedDeckPages =
    typeof sessionResult.data?.slides_page_count === "number"
      ? sessionResult.data.slides_page_count
      : 0;
  if (expectedDeckPages > deckPages.length) {
    incompleteReasons.push("deck pages failed to load");
  }
  const fullDeck = formatDeckPages(deckPages, 2_000_000);
  if (fullDeck.length > MAX_CANONICAL_DECK_CHARS) {
    incompleteReasons.push("deck character limit exceeded");
  }
  const deck = fullDeck.slice(0, MAX_CANONICAL_DECK_CHARS);

  let screen = "";
  try {
    const { data, error } = await supabase
      .from("live_lecture_screen_content")
      .select("seq, at_ms, title, extracted_text, table_markdown")
      .eq("session_id", sessionId)
      .order("seq", { ascending: true })
      .limit(201);
    if (!error && data) {
      if (data.length > 200) {
        incompleteReasons.push("screen extract limit exceeded");
      }
      const fullScreen = data
        .slice(0, 200)
        .map((row) => {
          const title =
            typeof row.title === "string" && row.title.trim()
              ? ` ${row.title.trim()}`
              : "";
          const text = String(row.extracted_text ?? "").trim();
          const table = String(row.table_markdown ?? "").trim();
          if (!text && !table) return "";
          return `[${formatTimestamp(Number(row.at_ms) || 0)}]${title}\n${[
            text,
            table,
          ]
            .filter(Boolean)
            .join("\n")}`;
        })
        .filter(Boolean)
        .join("\n\n");
      if (fullScreen.length > MAX_CANONICAL_SCREEN_CHARS) {
        incompleteReasons.push("screen extract character limit exceeded");
      }
      screen = fullScreen.slice(0, MAX_CANONICAL_SCREEN_CHARS);
    } else if (
      error &&
      !/does not exist|schema cache/i.test(error.message)
    ) {
      incompleteReasons.push("screen extract query failed");
    }
  } catch {
    incompleteReasons.push("screen extract query failed");
  }

  const materials: Array<{ name: string; text: string }> = [];
  let materialChars = 0;
  try {
    const { data, error } = await supabase
      .from("live_lecture_note_sources")
      .select("name, extracted_text")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(21);
    if (!error && data) {
      if (data.length > 20) {
        incompleteReasons.push("uploaded material count limit exceeded");
      }
      for (const row of data.slice(0, 20)) {
        const remaining = MAX_CANONICAL_MATERIAL_CHARS - materialChars;
        const raw = String(row.extracted_text ?? "").trim();
        if (remaining <= 0 || raw.length > remaining) {
          incompleteReasons.push("uploaded material character limit exceeded");
          break;
        }
        const text = raw.slice(0, remaining);
        if (!text) continue;
        materialChars += text.length;
        materials.push({
          name: String(row.name ?? "Uploaded material").slice(0, 200),
          text,
        });
      }
    } else if (
      error &&
      !/does not exist|schema cache/i.test(error.message)
    ) {
      incompleteReasons.push("uploaded material query failed");
    }
  } catch {
    incompleteReasons.push("uploaded material query failed");
  }

  return {
    transcript: transcript || undefined,
    deck: deck || undefined,
    screen: screen || undefined,
    materials,
    complete: incompleteReasons.length === 0,
    incompleteReasons,
  };
}
