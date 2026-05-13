export async function transcribeWithWhisper(params: {
  audio: Blob;
  apiKey: string;
}): Promise<string> {
  const fd = new FormData();
  fd.append("file", params.audio, "speech.webm");
  fd.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${params.apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Whisper HTTP ${res.status}: ${t.slice(0, 240)}`);
  }
  const j = (await res.json()) as { text?: string };
  return typeof j.text === "string" ? j.text.trim() : "";
}
