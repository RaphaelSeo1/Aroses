-- Prompt-cache token counts on the per-call Claude usage ledger (078).
--
-- With prompt caching, Anthropic's `input_tokens` only counts uncached input;
-- cache reads (billed 0.1× input) and cache writes (1.25× input, 5-minute
-- TTL) are reported separately. Without these columns the ledger would
-- under-count chat input. Cost per row:
--   input_tokens × in + cache_creation_input_tokens × 1.25 × in
--   + cache_read_input_tokens × 0.1 × in + output_tokens × out
-- Rows written before this migration read as 0. The writer
-- (src/lib/billing/ai-usage.ts) falls back to the old columns until applied.

alter table public.ai_usage_events
  add column if not exists cache_read_input_tokens integer not null default 0,
  add column if not exists cache_creation_input_tokens integer not null default 0;
