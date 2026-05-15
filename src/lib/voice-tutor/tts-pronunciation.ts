/**
 * Pre-processes text before it hits ElevenLabs TTS. This pass is now
 * deliberately conservative — modern TTS engines pronounce most English
 * just fine on their own, and aggressive substitutions (phonetic
 * spell-outs, dash→comma transforms, etc.) caused the voice to read
 * gibberish syllables or pause weirdly mid-sentence.
 *
 * Behaviour:
 *   • If the model supports IPA `<phoneme>` tags (currently only the
 *     `eleven_v3` family — multilingual_v2 ignores them silently), we
 *     wrap a small whitelist of known-mispronounced *scientific* terms
 *     in IPA tags. Everything else is passed through untouched.
 *   • Otherwise we return the input verbatim so the TTS engine can
 *     handle pronunciation natively.
 *
 * To force-fix a word for a non-v3 model, prefer ElevenLabs'
 * pronunciation-dictionary feature (configured on the dashboard) over
 * inline phonetic spell-outs.
 */

type ModelFamily = "v3" | "multilingual" | "turbo" | "english";

function modelFamily(modelId: string): ModelFamily {
  const id = modelId.toLowerCase();
  if (id.includes("v3")) return "v3";
  if (id.includes("multilingual")) return "multilingual";
  if (id.includes("turbo")) return "turbo";
  return "english";
}

/** Map of term → IPA. Keep this short and only for things the engine
 *  consistently butchers. Lower-case keys; replacement is case-insensitive
 *  and preserves the original casing of the matched word. */
const IPA_FIXES: Record<string, string> = {
  coulomb: "ˈkuːlɒm",
  "coulomb's": "ˈkuːlɒmz",
  eukaryote: "juːˈkærɪoʊt",
  prokaryote: "proʊˈkærɪoʊt",
  electronegativity: "ɪˌlɛktroʊˌnɛɡəˈtɪvɪti",
};

function buildTermRegex(): RegExp {
  const keys = Object.keys(IPA_FIXES).sort((a, b) => b.length - a.length);
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const TERM_RE = buildTermRegex();

export function preprocessTtsText(text: string, modelId: string): string {
  if (!text) return text;
  const family = modelFamily(modelId);
  // Only the v3 family reliably honours inline IPA phoneme tags. On
  // every other model we MUST pass the original text through unchanged
  // so the engine's own pronunciation kicks in.
  if (family !== "v3") return text;
  return text.replace(TERM_RE, (match) => {
    const ipa = IPA_FIXES[match.toLowerCase()];
    if (!ipa) return match;
    return `<phoneme alphabet="ipa" ph="${ipa}">${match}</phoneme>`;
  });
}
