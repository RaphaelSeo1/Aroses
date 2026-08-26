import type { SupabaseClient } from "@supabase/supabase-js";

export type DeckPage = {
  pageNum: number;
  title: string;
  extractedText: string;
};

export const MAX_DECK_PAGES = 200;
export const MAX_DECK_WRAPUP_CHARS = 80_000;
export const MAX_DECK_SYNTH_CHARS = 2_400;
export const MAX_DECK_SEED_CHARS = 7_000;
export const DECK_SEED_PAGES_PER_CALL = 6;
/** Transcript excerpt marker so later speech can @@revise slide-drafted sections. */
export const DECK_DRAFT_EXCERPT = "[drafted from uploaded slides]";

export function isSlideDeckSchemaError(message: string | undefined): boolean {
  const m = message ?? "";
  return (
    /live_lecture_slide_pages|slides_storage_path|slides_file_name|slides_page_count|slides_seeded_through_page/i.test(
      m
    ) && /does not exist|could not find|schema cache/i.test(m)
  );
}

export function titleFromSlideText(text: string, fallback: string): string {
  const line =
    text
      .split(/\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return (line || fallback).slice(0, 120);
}

/** Load all extracted pages for a session. Missing table ⇒ empty list. */
export async function loadSessionDeckPages(
  supabase: SupabaseClient,
  sessionId: string
): Promise<DeckPage[]> {
  try {
    const { data, error } = await supabase
      .from("live_lecture_slide_pages")
      .select("page_num, title, extracted_text")
      .eq("session_id", sessionId)
      .order("page_num", { ascending: true })
      .limit(MAX_DECK_PAGES);
    if (error || !data) return [];
    return data
      .map((r) => ({
        pageNum: Number(r.page_num) || 0,
        title: typeof r.title === "string" ? r.title : "",
        extractedText:
          typeof r.extracted_text === "string" ? r.extracted_text : "",
      }))
      .filter((p) => p.pageNum > 0 && p.extractedText.trim().length > 0);
  } catch {
    return [];
  }
}

export async function loadSessionDeckMeta(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ fileName: string | null; pageCount: number }> {
  try {
    const { data, error } = await supabase
      .from("live_lecture_sessions")
      .select("slides_file_name, slides_page_count")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !data) return { fileName: null, pageCount: 0 };
    const fileName =
      typeof data.slides_file_name === "string" && data.slides_file_name.trim()
        ? data.slides_file_name.trim()
        : null;
    const pageCount =
      typeof data.slides_page_count === "number" ? data.slides_page_count : 0;
    return { fileName, pageCount };
  } catch {
    return { fileName: null, pageCount: 0 };
  }
}

export function formatDeckPages(pages: DeckPage[], maxChars: number): string {
  if (pages.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const p of pages) {
    const head = p.title.trim()
      ? `[slide ${p.pageNum}] ${p.title.trim()}`
      : `[slide ${p.pageNum}]`;
    const block = `${head}\n${p.extractedText.trim()}`;
    if (used + block.length + 2 > maxChars && parts.length > 0) break;
    if (parts.length > 0) used += 2;
    parts.push(
      block.length + used > maxChars
        ? block.slice(0, Math.max(0, maxChars - used - 1)).trimEnd() + "…"
        : block
    );
    used += parts[parts.length - 1]!.length;
    if (used >= maxChars) break;
  }
  return parts.join("\n\n");
}

/** Next unseeded batch of slides for draft-from-deck note generation. */
export function takeDeckSeedBatch(
  pages: DeckPage[],
  afterPage: number,
  maxPages = DECK_SEED_PAGES_PER_CALL,
  maxChars = MAX_DECK_SEED_CHARS
): { pages: DeckPage[]; text: string; throughPage: number; remaining: number } {
  const rest = pages.filter((p) => p.pageNum > afterPage);
  const chosen: DeckPage[] = [];
  let used = 0;
  for (const p of rest) {
    if (chosen.length >= maxPages) break;
    const blockLen = p.title.length + p.extractedText.length + 24;
    if (chosen.length > 0 && used + blockLen > maxChars) break;
    chosen.push(p);
    used += blockLen;
  }
  const throughPage =
    chosen.length > 0 ? chosen[chosen.length - 1]!.pageNum : afterPage;
  return {
    pages: chosen,
    text: formatDeckPages(chosen, maxChars),
    throughPage,
    remaining: Math.max(0, rest.length - chosen.length),
  };
}

/** Full-deck text for wrap-up / course ingest (capped). */
export function formatDeckForWrapUp(pages: DeckPage[]): string {
  if (pages.length === 0) return "";
  const blocks = pages.map((p) => {
    const head = p.title.trim()
      ? `[slide ${p.pageNum}] ${p.title.trim()}`
      : `[slide ${p.pageNum}]`;
    return `${head}\n${p.extractedText.trim()}`;
  });
  return blocks.join("\n\n").slice(0, MAX_DECK_WRAPUP_CHARS);
}
