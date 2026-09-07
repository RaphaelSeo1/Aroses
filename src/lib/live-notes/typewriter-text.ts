/** Split streamed model text into bounded visible typing ticks. */
export function chunkTypewriterText(text: string, charsPerTick: number): string[] {
  if (!text) return [];
  const size = Math.max(1, Math.floor(charsPerTick));
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(""));
  }
  return chunks;
}
