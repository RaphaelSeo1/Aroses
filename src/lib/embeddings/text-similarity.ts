const EMBED_DIM = 256;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 240);
}

/** Deterministic bag-of-tokens embedding (no external API). */
export function embedTextLocal(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM);
  for (const token of tokenize(text)) {
    let h = 0;
    for (let i = 0; i < token.length; i++) {
      h = (h * 31 + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % EMBED_DIM;
    vec[idx]! += 1;
  }
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

/** OpenAI text-embedding-3-small when `OPENAI_API_KEY` is set; else local. */
export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim().slice(0, 8_000);
  if (!trimmed) return embedTextLocal("");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return embedTextLocal(trimmed);

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: trimmed,
      }),
    });
    if (!res.ok) return embedTextLocal(trimmed);
    const body = (await res.json()) as {
      data?: { embedding?: number[] }[];
    };
    const emb = body.data?.[0]?.embedding;
    if (!Array.isArray(emb) || emb.length === 0) return embedTextLocal(trimmed);
    return emb;
  } catch {
    return embedTextLocal(trimmed);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export async function embedTextsBatch(
  texts: string[],
  concurrency = 8
): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, texts.length)) },
    async () => {
      while (i < texts.length) {
        const idx = i++;
        out[idx] = await embedText(texts[idx] ?? "");
      }
    }
  );
  await Promise.all(workers);
  return out;
}
