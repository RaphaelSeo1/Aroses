import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
});

function collectText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === "string") {
    const t = node.trim();
    if (t) out.push(t);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectText(x, out);
    return;
  }
  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (typeof rec["#text"] === "string") {
      const t = rec["#text"].trim();
      if (t) out.push(t);
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "#text") continue;
      collectText(v, out);
    }
  }
}

export type SlideExtract = {
  index: number;
  title: string;
  body: string;
  notes: string;
};

export async function extractPptxSlides(
  buffer: Buffer
): Promise<{ slides: SlideExtract[]; plainText: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });

  if (slideNames.length === 0) {
    throw new Error(
      "No slides found. Save as .pptx (PowerPoint 2007+) or export slides as PDF."
    );
  }

  const slides: SlideExtract[] = [];

  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i];
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    const parsed = parser.parse(xml);
    const texts: string[] = [];
    collectText(parsed, texts);
    const body = texts.join(" ").replace(/\s+/g, " ").trim();
    const title = texts[0]?.slice(0, 120) ?? `Slide ${i + 1}`;

    let notes = "";
    const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    const notesXml = await zip.file(notesPath)?.async("string");
    if (notesXml) {
      const noteTexts: string[] = [];
      collectText(parser.parse(notesXml), noteTexts);
      notes = noteTexts.join(" ").replace(/\s+/g, " ").trim();
    }

    slides.push({ index: i + 1, title, body, notes });
  }

  const plainText = slides
    .map((s) => {
      const parts = [`--- Slide ${s.index}: ${s.title} ---`, s.body];
      if (s.notes) parts.push(`(Speaker notes: ${s.notes})`);
      return parts.join("\n");
    })
    .join("\n\n");

  return { slides, plainText };
}
