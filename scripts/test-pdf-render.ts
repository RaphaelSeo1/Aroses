import { createClient } from "@supabase/supabase-js";
import {
  getPdfPageCount,
  renderPdfPagesToPng,
} from "@/lib/study-ingest/source-images/render-pdf-page";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";

async function main() {
  const path =
    process.argv[2] ??
    "0a5da40a-2d32-4bb9-9ef0-107d6557a88f/e6ac7d81-1396-40f7-4314ce10c94b.pdf";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const admin = createClient(url, key);
  const { data, error } = await admin.storage
    .from(STUDY_PDF_INGEST_BUCKET)
    .download(path);
  console.log("download", { error: error?.message, ok: !!data });
  if (!data) return;
  const buf = Buffer.from(await data.arrayBuffer());
  console.log("bytes", buf.length);
  const pages = await getPdfPageCount(buf);
  console.log("pageCount", pages);
  const rendered = await renderPdfPagesToPng(buf, [1, 2, 3], "test.pdf");
  console.log(
    "rendered",
    rendered.length,
    rendered.map((r) => r.buffer.length)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
