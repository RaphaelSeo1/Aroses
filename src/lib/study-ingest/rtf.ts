/** Minimal RTF → plain text for course ingest (not a full RTF parser). */
export function rtfToPlainText(rtf: string): string {
  let s = rtf;
  s = s.replace(/\\par[d]?\b/gi, "\n");
  s = s.replace(/\\line\b/gi, "\n");
  s = s.replace(/\\tab\b/gi, "\t");
  s = s.replace(/\\'[0-9a-f]{2}/gi, (m) => {
    const hex = m.slice(2);
    const code = parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : "";
  });
  s = s.replace(/\\[a-z]+\d* ?/gi, "");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\r\n/g, "\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
