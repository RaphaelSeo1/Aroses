/**
 * Tables the course builder extracts from PDFs (text layer → cleanup), for
 * judging real vs false tables by eye. No network, no AI.
 * Usage: npx tsx scripts/diagnose-course-build-tables.ts out.md file1.pdf [file2.pdf ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { cleanPages } from "@/lib/course-build/clean";
import { extractPdfPagesWithTables } from "@/lib/course-build/pdf-text";
import { markdownTables } from "@/lib/course-build/tables";

/** Latin-script tokens this long are almost always words run together. */
const GLUED = /\b[\p{Script=Latin}]{22,}\b/gu;

async function main() {
  const [out, ...files] = process.argv.slice(2);
  if (!out || files.length === 0) {
    console.error("usage: diagnose-course-build-tables.ts out.md file.pdf ...");
    process.exit(1);
  }
  const report: string[] = [];
  const summary: string[] = [];
  for (const file of files) {
    const t0 = Date.now();
    const pages = cleanPages(await extractPdfPagesWithTables(readFileSync(file)));
    let tables = 0;
    const glued = new Set<string>();
    report.push(`\n\n# ${basename(file)} (${pages.length} pages)\n`);
    for (const p of pages) {
      for (const w of p.text.match(GLUED) ?? []) glued.add(w);
      const found = markdownTables(p.text);
      if (found.length === 0) continue;
      tables += found.length;
      const prose = p.text
        .split("\n")
        .filter((l) => !/^\|.*\|$/.test(l.trim()))
        .join(" ")
        .slice(0, 400);
      report.push(`\n## p${p.n}: ${found.length} table(s)\nPage text: ${prose}\n`);
      for (const t of found) report.push(`\n${t}\n`);
    }
    report.push(`\nLong Latin tokens: ${[...glued].slice(0, 30).join(", ") || "none"}\n`);
    summary.push(`${basename(file)}\tpages=${pages.length}\ttables=${tables}\tlongTokens=${glued.size}\t${Date.now() - t0}ms`);
  }
  writeFileSync(out, `${summary.join("\n")}\n${report.join("")}`);
  console.log(summary.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
