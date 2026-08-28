/** Strip markdown so TTS reads the reply as speech, not syntax. */
export function speakableText(markdown: string): string {
  let s = markdown.trim();
  if (!s) return "";
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*>\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/[*_~]+/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 6000);
}
