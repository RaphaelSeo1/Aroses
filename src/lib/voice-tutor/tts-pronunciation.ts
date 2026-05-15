/**
 * Pre-processes text before it hits ElevenLabs TTS so pronunciation of
 * common scientific / academic terms comes out correctly. Two passes:
 *
 *   1. Domain dictionary — replaces frequently-mispronounced terms with
 *      either explicit phonetic spellings or IPA tags (when the v3 model
 *      is in use). Edit the `TERM_FIXES` table to add more terms.
 *
 *   2. Light cleanup — expand a handful of always-mangled abbreviations,
 *      add commas around lone numbers, and trim runaway whitespace.
 *
 * Note: IPA phoneme tags (`<phoneme alphabet="ipa" ph="...">word</phoneme>`)
 * only render correctly on `eleven_v3` and `eleven_multilingual_v2`. On
 * other models the tag is ignored so we fall back to the spelled-out
 * form. We choose between them at runtime.
 */

type ModelFamily = "v3" | "multilingual" | "turbo" | "english";

function modelFamily(modelId: string): ModelFamily {
  const id = modelId.toLowerCase();
  if (id.includes("v3")) return "v3";
  if (id.includes("multilingual")) return "multilingual";
  if (id.includes("turbo")) return "turbo";
  return "english";
}

/** Map of term → { spell, ipa }. `spell` is the safe fallback when IPA
 *  isn't supported by the model. Keep terms lowercase; replacement is
 *  case-insensitive and preserves the original casing as best it can. */
const TERM_FIXES: Record<string, { spell: string; ipa?: string }> = {
  // ── Chemistry / physics ──────────────────────────────────────────────
  coulomb: { spell: "koo-lohm", ipa: "ˈkuːlɒm" },
  "coulomb's": { spell: "koo-lohms", ipa: "ˈkuːlɒmz" },
  ionic: { spell: "eye-on-ick", ipa: "aɪˈɒnɪk" },
  ion: { spell: "eye-on", ipa: "ˈaɪɒn" },
  ions: { spell: "eye-ons", ipa: "ˈaɪɒnz" },
  cation: { spell: "cat-eye-on", ipa: "ˈkæt.aɪ.ɒn" },
  cations: { spell: "cat-eye-ons", ipa: "ˈkæt.aɪ.ɒnz" },
  anion: { spell: "ann-eye-on", ipa: "ˈæn.aɪ.ɒn" },
  anions: { spell: "ann-eye-ons", ipa: "ˈæn.aɪ.ɒnz" },
  covalent: { spell: "co-vay-lent", ipa: "koʊˈveɪlənt" },
  electronegativity: {
    spell: "ee-lek-troh-neg-uh-tiv-ih-tee",
    ipa: "ɪˌlɛk.troʊˌnɛɡ.əˈtɪv.ɪ.ti",
  },

  // ── Biology / medicine ───────────────────────────────────────────────
  mitochondria: {
    spell: "my-toh-kon-dree-uh",
    ipa: "ˌmaɪ.təˈkɒn.dri.ə",
  },
  mitochondrion: {
    spell: "my-toh-kon-dree-on",
    ipa: "ˌmaɪ.təˈkɒn.dri.ɒn",
  },
  photosynthesis: {
    spell: "foh-toh-sin-thuh-sis",
    ipa: "ˌfoʊ.toʊˈsɪn.θə.sɪs",
  },
  chromosome: { spell: "kroh-muh-zohm", ipa: "ˈkroʊ.məˌzoʊm" },
  eukaryote: { spell: "you-kair-ee-oht", ipa: "juːˈkær.i.oʊt" },
  prokaryote: { spell: "pro-kair-ee-oht", ipa: "proʊˈkær.i.oʊt" },
  cytokine: { spell: "sigh-toh-kine", ipa: "ˈsaɪ.toʊˌkaɪn" },

  // ── CS / math common offenders ───────────────────────────────────────
  kubernetes: { spell: "koo-ber-net-eez", ipa: "ˌkuː.bərˈnɛt.iːz" },
  nginx: { spell: "engine-ex" },
  postgres: { spell: "post-gress" },
  postgresql: { spell: "post-gress-cue-el" },
  oauth: { spell: "oh-auth" },
  regex: { spell: "redge-ex" },
  llm: { spell: "L-L-M" },
  url: { spell: "U-R-L" },
  api: { spell: "A-P-I" },
};

/** Match a *whole word* (so "ion" doesn't replace inside "lotion"). */
function buildTermRegex(): RegExp {
  const keys = Object.keys(TERM_FIXES).sort((a, b) => b.length - a.length);
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const TERM_RE = buildTermRegex();

function applyTermFixes(text: string, family: ModelFamily): string {
  const supportsIpa = family === "v3" || family === "multilingual";
  return text.replace(TERM_RE, (match) => {
    const fix = TERM_FIXES[match.toLowerCase()];
    if (!fix) return match;
    if (supportsIpa && fix.ipa) {
      return `<phoneme alphabet="ipa" ph="${fix.ipa}">${match}</phoneme>`;
    }
    return fix.spell;
  });
}

/** Light cleanup that helps every model. */
function lightCleanup(text: string): string {
  return text
    // Normalize unicode dashes to commas so the TTS pauses naturally.
    .replace(/[—–]/g, ", ")
    // Collapse runs of whitespace.
    .replace(/\s+/g, " ")
    .trim();
}

export function preprocessTtsText(text: string, modelId: string): string {
  if (!text) return text;
  const family = modelFamily(modelId);
  return applyTermFixes(lightCleanup(text), family);
}
