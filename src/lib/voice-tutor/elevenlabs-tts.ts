export async function synthesizeElevenLabs(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
}): Promise<ArrayBuffer> {
  const text = params.text.trim().slice(0, 4500);
  if (!text) {
    throw new Error("EMPTY_TTS_TEXT");
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": params.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        model_id: params.modelId,
        text,
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs HTTP ${res.status}: ${t.slice(0, 240)}`);
  }
  return res.arrayBuffer();
}
