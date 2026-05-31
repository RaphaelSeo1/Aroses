/**
 * Markdown in this app is rendered with `$`-delimited LaTeX math (remark-math +
 * KaTeX). That breaks plain currency: text like "$200,000 ... $100,000" is
 * parsed as a math span, so everything between the two dollar amounts renders
 * as garbled italics.
 *
 * Escape dollar signs that are clearly currency — a `$` directly before a digit
 * (optionally separated by a single space) — so they render as literal `$`.
 * Real inline math like `$x^2$` (starts with a non-digit) and display math
 * `$$...$$` are left untouched, and `\$` that's already escaped is skipped.
 */
export function escapeCurrencyDollars(markdown: string): string {
  if (!markdown.includes("$")) return markdown;
  return markdown.replace(/(?<![\\$])\$(?=\s?\d)/g, "\\$");
}
