/**
 * Languages a course can be built in. Pure and client-safe: the upload screen
 * reads the menu from here, the server resolves budgets and strings from it.
 */

export type BuildLanguageCode =
  | "en" | "es" | "fr" | "de" | "pt" | "it" | "ru" | "tr" | "vi" | "id" | "hi" | "ar" | "ko" | "ja" | "zh" | "zh-Hant";

export type BuildLanguage = {
  code: BuildLanguageCode;
  /** English name, used in prompts and stored on the build. */
  name: string;
  /** Menu label, in the language's own script. */
  native: string;
  dir: "ltr" | "rtl";
  /** Haiku 4.5 tokens for the same passage relative to English (measured with count_tokens). */
  tokenRatio: number;
  /** Scripts written without spaces are measured in characters. */
  unit: "word" | "char";
  /** Output tokens per word (or character) of lesson prose. */
  tokensPerUnit: number;
};

export const BUILD_LANGUAGES: readonly BuildLanguage[] = [
  { code: "en", name: "English", native: "English", dir: "ltr", tokenRatio: 1, unit: "word", tokensPerUnit: 1.35 },
  { code: "es", name: "Spanish", native: "Español", dir: "ltr", tokenRatio: 1.56, unit: "word", tokensPerUnit: 1.64 },
  { code: "fr", name: "French", native: "Français", dir: "ltr", tokenRatio: 1.79, unit: "word", tokensPerUnit: 1.93 },
  { code: "de", name: "German", native: "Deutsch", dir: "ltr", tokenRatio: 1.92, unit: "word", tokensPerUnit: 2.5 },
  { code: "pt", name: "Portuguese", native: "Português", dir: "ltr", tokenRatio: 1.63, unit: "word", tokensPerUnit: 1.85 },
  { code: "it", name: "Italian", native: "Italiano", dir: "ltr", tokenRatio: 1.55, unit: "word", tokensPerUnit: 1.95 },
  { code: "ru", name: "Russian", native: "Русский", dir: "ltr", tokenRatio: 1.94, unit: "word", tokensPerUnit: 3.1 },
  { code: "tr", name: "Turkish", native: "Türkçe", dir: "ltr", tokenRatio: 2.04, unit: "word", tokensPerUnit: 3.25 },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", dir: "ltr", tokenRatio: 2.79, unit: "word", tokensPerUnit: 2.4 },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", dir: "ltr", tokenRatio: 1.75, unit: "word", tokensPerUnit: 2.65 },
  { code: "hi", name: "Hindi", native: "हिन्दी", dir: "ltr", tokenRatio: 3.96, unit: "word", tokensPerUnit: 4.45 },
  { code: "ar", name: "Arabic", native: "العربية", dir: "rtl", tokenRatio: 2.89, unit: "word", tokensPerUnit: 4.3 },
  { code: "ko", name: "Korean", native: "한국어", dir: "ltr", tokenRatio: 2.45, unit: "word", tokensPerUnit: 4.45 },
  { code: "ja", name: "Japanese", native: "日本語", dir: "ltr", tokenRatio: 1.8, unit: "char", tokensPerUnit: 1.1 },
  { code: "zh", name: "Chinese (Simplified)", native: "简体中文", dir: "ltr", tokenRatio: 1.62, unit: "char", tokensPerUnit: 1.18 },
  { code: "zh-Hant", name: "Chinese (Traditional)", native: "繁體中文", dir: "ltr", tokenRatio: 1.69, unit: "char", tokensPerUnit: 1.23 },
];

export const MATCH_MY_FILES = "auto";

export const BUILD_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: MATCH_MY_FILES, label: "Match my files" },
  ...BUILD_LANGUAGES.map((l) => ({ value: l.code, label: l.native })),
];

const BY_CODE = new Map<string, BuildLanguage>(BUILD_LANGUAGES.map((l) => [l.code.toLowerCase(), l]));
/** Names stored on older builds. */
const LEGACY_NAMES: Record<string, BuildLanguageCode> = { chinese: "zh" };

export function languageByCode(code: unknown): BuildLanguage | null {
  return typeof code === "string" ? (BY_CODE.get(code.trim().toLowerCase()) ?? null) : null;
}

/** Accepts a code ("de") or a stored name ("German"). */
export function findLanguage(value: unknown): BuildLanguage | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  return (
    BY_CODE.get(v) ??
    BUILD_LANGUAGES.find((l) => l.name.toLowerCase() === v) ??
    (LEGACY_NAMES[v] ? BY_CODE.get(LEGACY_NAMES[v]!.toLowerCase())! : null)
  );
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u;
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const DEVANAGARI = /[\u0900-\u097f]/u;
const CYRILLIC = /[\u0400-\u04ff]/u;
const LATIN = /[a-z\u00c0-\u024f\u1e00-\u1eff]/iu;
/** Characters of scripts written without spaces between words. */
const UNSPACED = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

type Script = "hangul" | "kana" | "han" | "arabic" | "devanagari" | "cyrillic" | "latin" | "other";

function scriptOf(ch: string): Script | null {
  if (LATIN.test(ch)) return "latin";
  if (HANGUL.test(ch)) return "hangul";
  if (KANA.test(ch)) return "kana";
  if (HAN.test(ch)) return "han";
  if (ARABIC.test(ch)) return "arabic";
  if (DEVANAGARI.test(ch)) return "devanagari";
  if (CYRILLIC.test(ch)) return "cyrillic";
  return /\p{L}/u.test(ch) ? "other" : null;
}

/**
 * How many Latin characters one character of each script is worth in
 * content (the same passage: 359 English chars, 162 Korean, 123 Japanese,
 * 103 Chinese). Alphabetic scripts count as one.
 */
const CONTENT_WEIGHT: Record<Script, number> = {
  latin: 1,
  hangul: 2.2,
  kana: 2.5,
  han: 3.5,
  arabic: 1.2,
  devanagari: 1,
  cyrillic: 1,
  other: 1,
};

function scriptCounts(text: string): Record<Script, number> {
  const out: Record<Script, number> = { hangul: 0, kana: 0, han: 0, arabic: 0, devanagari: 0, cyrillic: 0, latin: 0, other: 0 };
  for (const ch of text) {
    const s = scriptOf(ch);
    if (s) out[s] += 1;
  }
  return out;
}

/** Text length in Latin-character equivalents, so page budgets treat every script alike. */
export function contentLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const s = scriptOf(ch);
    n += s ? CONTENT_WEIGHT[s] : 1;
  }
  return n;
}

/** English-word equivalents: spaced words, plus unspaced (CJK) characters at their content weight. */
export function wordCount(text: string): number {
  let words = 0;
  let unspaced = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    let cjk = 0;
    let rest = false;
    for (const ch of token) {
      if (UNSPACED.test(ch)) cjk += KANA.test(ch) ? CONTENT_WEIGHT.kana : CONTENT_WEIGHT.han;
      else if (/[\p{L}\p{N}]/u.test(ch)) rest = true;
    }
    unspaced += cjk;
    if (rest || cjk === 0) words += 1;
  }
  // 359 chars of English is 55 words: about 6.5 chars a word.
  return words + Math.round(unspaced / 6.5);
}

/** Length for "is this text too short to use" checks: one CJK character counts as two. */
export function visibleLength(text: string): number {
  let n = 0;
  for (const ch of text.trim()) n += UNSPACED.test(ch) || HANGUL.test(ch) ? 2 : 1;
  return n;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Frequent function words. A word listed for two languages counts for neither. */
const STOPWORDS: Partial<Record<BuildLanguageCode, string>> = {
  en: "the and of to is in that are with for this by as be which it from or an not was can",
  es: "el la los las de que y en es por para con una del se al como su más pero sus le lo",
  fr: "le la les des et est une du que en pour dans qui sur par pas au avec son sont ce aux",
  de: "der die das und ist nicht mit von den zu ein eine auf sich im dem des auch werden wird",
  pt: "o a os as de que e é do da em para uma com não dos das no na ao se mais pelo",
  it: "il la di che e è per un una del della sono con non gli le nel alla dei delle anche",
  tr: "ve bir bu için ile da de olan olarak çok daha gibi en ise kadar sonra veya",
  id: "dan yang di ini itu dengan untuk dari pada adalah tidak dalam akan juga atau oleh",
};

const STOP_INDEX: Map<string, BuildLanguageCode> = (() => {
  const seen = new Map<string, BuildLanguageCode | null>();
  for (const [code, list] of Object.entries(STOPWORDS) as Array<[BuildLanguageCode, string]>) {
    for (const w of list.split(" ")) seen.set(w, seen.has(w) && seen.get(w) !== code ? null : code);
  }
  const out = new Map<string, BuildLanguageCode>();
  for (const [w, c] of seen) if (c) out.set(w, c);
  return out;
})();

const VIETNAMESE = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/giu;
const PERSIAN_URDU = /[\u067e\u0686\u0698\u06af\u06a9\u06cc\u0679\u0688\u0691\u06ba\u06be\u06c1\u06d2]/gu;
const UKRAINIAN_ETC = /[іїєґўђјљњћџ]/giu;
const HINDI_WORDS = /(^|\s)(है|हैं|के|में|की|और|से|को|का|एक|यह|होता|होती)(?=\s|[।,.]|$)/gu;
const SIMPLIFIED = /[这们说为发会对经过还没关问题应该实际种类动时国来个样与产们书长门见现开么]/gu;
const TRADITIONAL = /[這們說為發會對經過還沒關問題應該實際種類動時國來個樣與產們書長門見現開麼]/gu;

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function latinLanguage(text: string): BuildLanguage | null {
  const letters = count(text, /\p{L}/gu);
  if (count(text, VIETNAMESE) >= Math.max(5, letters * 0.04)) return languageByCode("vi");
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 12) return null;
  const hits = new Map<BuildLanguageCode, number>();
  for (const w of words) {
    const c = STOP_INDEX.get(w);
    if (c) hits.set(c, (hits.get(c) ?? 0) + 1);
  }
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] < Math.max(4, words.length * 0.05)) return null;
  if (second && top[1] < second[1] * 1.5) return null;
  return languageByCode(top[0]);
}

/**
 * The main language of the source text, or null when it isn't clearly one of
 * the offered languages (the writer is then told to match the pages).
 * Scripts are weighed by content, so Korean notes full of English drug
 * names still read as Korean.
 */
export function detectLanguage(text: string): BuildLanguage | null {
  const sample = text.length > 60_000 ? text.slice(0, 60_000) : text;
  const c = scriptCounts(sample);
  const weighted: Array<[Script, number]> = (Object.keys(c) as Script[]).map((s) => [s, c[s] * CONTENT_WEIGHT[s]]);
  const cjk = c.kana * CONTENT_WEIGHT.kana + c.han * CONTENT_WEIGHT.han;
  const groups: Array<[string, number]> = [
    ["cjk", cjk],
    ...weighted.filter(([s]) => s !== "kana" && s !== "han"),
  ];
  const total = groups.reduce((sum, [, n]) => sum + n, 0);
  if (total < 40) return null;
  const [top, n] = groups.sort((a, b) => b[1] - a[1])[0]!;
  if (n < total * 0.45) return null;
  switch (top) {
    case "cjk": {
      if (c.kana >= (c.kana + c.han) * 0.15) return languageByCode("ja");
      return languageByCode(count(sample, TRADITIONAL) > count(sample, SIMPLIFIED) ? "zh-Hant" : "zh");
    }
    case "hangul":
      return languageByCode("ko");
    case "arabic":
      return count(sample, PERSIAN_URDU) > c.arabic * 0.02 ? null : languageByCode("ar");
    case "devanagari":
      return count(sample, HINDI_WORDS) >= 3 ? languageByCode("hi") : null;
    case "cyrillic":
      return count(sample, UKRAINIAN_ETC) > c.cyrillic * 0.005 ? null : languageByCode("ru");
    case "latin":
      return latinLanguage(sample);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * Output budgets grow with the language's token cost so a Spanish or Korean
 * module teaches about as much as an English one, up to this multiple.
 */
export const MAX_LANGUAGE_FACTOR = 2;

/** Token cost of an unknown language, by the source's main script. */
function scriptFactor(text: string): number {
  const c = scriptCounts(text.slice(0, 20_000));
  const letters = Object.values(c).reduce((a, b) => a + b, 0);
  return letters > 0 && c.latin / letters >= 0.6 ? 1.6 : MAX_LANGUAGE_FACTOR;
}

export function languageFactor(lang: BuildLanguage | null, sourceText = ""): number {
  const ratio = lang ? lang.tokenRatio : scriptFactor(sourceText);
  return Math.min(MAX_LANGUAGE_FACTOR, Math.max(1, ratio));
}

// ---------------------------------------------------------------------------
// Builder strings shown in lessons
// ---------------------------------------------------------------------------

export type BuilderStrings = {
  locator: (kind: "page" | "slide" | "part", a: number, b: number) => string;
  figureFromPage: (n: number) => string;
  quizFallback: string;
  module: (n: number) => string;
  continued: (title: string) => string;
  untitled: string;
};

type Nouns = Record<"page" | "slide" | "part", [one: string, many: string]>;

/** "page 3" / "pages 3–5" for languages that put the noun first. */
function nounFirst(nouns: Nouns) {
  return (kind: "page" | "slide" | "part", a: number, b: number) =>
    a === b ? `${nouns[kind][0]} ${a}` : `${nouns[kind][1]} ${a}–${b}`;
}

function range(a: number, b: number): string {
  return a === b ? String(a) : `${a}–${b}`;
}

const STRINGS: Record<BuildLanguageCode, BuilderStrings> = {
  en: {
    locator: nounFirst({ page: ["page", "pages"], slide: ["slide", "slides"], part: ["part", "parts"] }),
    figureFromPage: (n) => `From page ${n} of your file`,
    quizFallback: "Review the module lessons for this idea.",
    module: (n) => `Module ${n}`,
    continued: (t) => `${t}, continued`,
    untitled: "Untitled material",
  },
  es: {
    locator: nounFirst({ page: ["página", "páginas"], slide: ["diapositiva", "diapositivas"], part: ["parte", "partes"] }),
    figureFromPage: (n) => `De la página ${n} de tu archivo`,
    quizFallback: "Repasa las lecciones del módulo sobre esta idea.",
    module: (n) => `Módulo ${n}`,
    continued: (t) => `${t} (continuación)`,
    untitled: "Material sin título",
  },
  fr: {
    locator: nounFirst({ page: ["page", "pages"], slide: ["diapositive", "diapositives"], part: ["partie", "parties"] }),
    figureFromPage: (n) => `Tiré de la page ${n} de ton fichier`,
    quizFallback: "Revois les leçons du module sur cette notion.",
    module: (n) => `Module ${n}`,
    continued: (t) => `${t} (suite)`,
    untitled: "Support sans titre",
  },
  de: {
    locator: nounFirst({ page: ["Seite", "Seiten"], slide: ["Folie", "Folien"], part: ["Teil", "Teile"] }),
    figureFromPage: (n) => `Von Seite ${n} deiner Datei`,
    quizFallback: "Wiederhole die Lektionen des Moduls zu diesem Punkt.",
    module: (n) => `Modul ${n}`,
    continued: (t) => `${t} (Fortsetzung)`,
    untitled: "Unbenanntes Material",
  },
  pt: {
    locator: nounFirst({ page: ["página", "páginas"], slide: ["slide", "slides"], part: ["parte", "partes"] }),
    figureFromPage: (n) => `Da página ${n} do seu arquivo`,
    quizFallback: "Revise as lições do módulo sobre esta ideia.",
    module: (n) => `Módulo ${n}`,
    continued: (t) => `${t} (continuação)`,
    untitled: "Material sem título",
  },
  it: {
    locator: nounFirst({ page: ["pagina", "pagine"], slide: ["diapositiva", "diapositive"], part: ["parte", "parti"] }),
    figureFromPage: (n) => `Dalla pagina ${n} del tuo file`,
    quizFallback: "Ripassa le lezioni del modulo su questo concetto.",
    module: (n) => `Modulo ${n}`,
    continued: (t) => `${t} (continua)`,
    untitled: "Materiale senza titolo",
  },
  ru: {
    locator: nounFirst({ page: ["страница", "страницы"], slide: ["слайд", "слайды"], part: ["часть", "части"] }),
    figureFromPage: (n) => `Со страницы ${n} вашего файла`,
    quizFallback: "Повторите уроки модуля по этой теме.",
    module: (n) => `Модуль ${n}`,
    continued: (t) => `${t} (продолжение)`,
    untitled: "Материал без названия",
  },
  tr: {
    locator: nounFirst({ page: ["sayfa", "sayfa"], slide: ["slayt", "slayt"], part: ["bölüm", "bölüm"] }),
    figureFromPage: (n) => `Dosyanızın ${n}. sayfasından`,
    quizFallback: "Bu konu için modülün derslerini gözden geçirin.",
    module: (n) => `Modül ${n}`,
    continued: (t) => `${t} (devamı)`,
    untitled: "Adsız materyal",
  },
  vi: {
    locator: nounFirst({ page: ["trang", "trang"], slide: ["trang chiếu", "trang chiếu"], part: ["phần", "phần"] }),
    figureFromPage: (n) => `Từ trang ${n} trong tệp của bạn`,
    quizFallback: "Hãy xem lại các bài học của mô-đun về ý này.",
    module: (n) => `Mô-đun ${n}`,
    continued: (t) => `${t} (tiếp theo)`,
    untitled: "Tài liệu chưa đặt tên",
  },
  id: {
    locator: nounFirst({ page: ["halaman", "halaman"], slide: ["slide", "slide"], part: ["bagian", "bagian"] }),
    figureFromPage: (n) => `Dari halaman ${n} file Anda`,
    quizFallback: "Tinjau kembali pelajaran modul tentang gagasan ini.",
    module: (n) => `Modul ${n}`,
    continued: (t) => `${t} (lanjutan)`,
    untitled: "Materi tanpa judul",
  },
  hi: {
    locator: nounFirst({ page: ["पृष्ठ", "पृष्ठ"], slide: ["स्लाइड", "स्लाइड"], part: ["भाग", "भाग"] }),
    figureFromPage: (n) => `आपकी फ़ाइल के पृष्ठ ${n} से`,
    quizFallback: "इस विचार के लिए मॉड्यूल के पाठ दोबारा देखें।",
    module: (n) => `मॉड्यूल ${n}`,
    continued: (t) => `${t} (जारी)`,
    untitled: "बिना शीर्षक की सामग्री",
  },
  ar: {
    locator: nounFirst({ page: ["الصفحة", "الصفحات"], slide: ["الشريحة", "الشرائح"], part: ["الجزء", "الأجزاء"] }),
    figureFromPage: (n) => `من الصفحة ${n} في ملفك`,
    quizFallback: "راجع دروس الوحدة حول هذه الفكرة.",
    module: (n) => `الوحدة ${n}`,
    continued: (t) => `${t} (تتمة)`,
    untitled: "مادة بلا عنوان",
  },
  ko: {
    locator: (kind, a, b) =>
      kind === "page" ? `${range(a, b)}쪽` : kind === "slide" ? `슬라이드 ${range(a, b)}` : `${range(a, b)}부`,
    figureFromPage: (n) => `파일 ${n}쪽에서 가져옴`,
    quizFallback: "모듈 레슨에서 이 개념을 다시 복습하세요.",
    module: (n) => `모듈 ${n}`,
    continued: (t) => `${t} (계속)`,
    untitled: "제목 없는 자료",
  },
  ja: {
    locator: (kind, a, b) =>
      kind === "page" ? `${range(a, b)}ページ` : kind === "slide" ? `スライド${range(a, b)}` : `パート${range(a, b)}`,
    figureFromPage: (n) => `ファイルの${n}ページより`,
    quizFallback: "この内容はモジュールのレッスンで復習しましょう。",
    module: (n) => `モジュール${n}`,
    continued: (t) => `${t}（続き）`,
    untitled: "無題の教材",
  },
  zh: {
    locator: (kind, a, b) =>
      kind === "page" ? `第${range(a, b)}页` : kind === "slide" ? `第${range(a, b)}张幻灯片` : `第${range(a, b)}部分`,
    figureFromPage: (n) => `来自文件第${n}页`,
    quizFallback: "请复习本模块中关于这一概念的课程。",
    module: (n) => `模块${n}`,
    continued: (t) => `${t}（续）`,
    untitled: "未命名材料",
  },
  "zh-Hant": {
    locator: (kind, a, b) =>
      kind === "page" ? `第${range(a, b)}頁` : kind === "slide" ? `第${range(a, b)}張投影片` : `第${range(a, b)}部分`,
    figureFromPage: (n) => `來自檔案第${n}頁`,
    quizFallback: "請複習本模組中關於這個概念的課程。",
    module: (n) => `模組${n}`,
    continued: (t) => `${t}（續）`,
    untitled: "未命名教材",
  },
};

/** English when the language is unknown. */
export function builderStrings(lang: BuildLanguage | null | undefined): BuilderStrings {
  return STRINGS[lang?.code ?? "en"];
}

export function locatorKind(sourceKind: string): "page" | "slide" | "part" {
  return sourceKind === "pptx" ? "slide" : sourceKind === "pdf" ? "page" : "part";
}

// ---------------------------------------------------------------------------
// Resolving a build's language
// ---------------------------------------------------------------------------

export type BuildLanguagePlan = {
  /** What the course is written in; null when neither chosen nor detected. */
  output: BuildLanguage | null;
  /** What the files are written in, when clear. */
  source: BuildLanguage | null;
  /** Output differs from the files, so source wording can't be shown verbatim. */
  converting: boolean;
  /** Output token cost vs English (1–2): scales the writer's budgets. */
  factor: number;
  /** The larger of the source's and the output's token cost: scales the spend cap. */
  costFactor: number;
  strings: BuilderStrings;
};

/** `chosen` is the stored name (or code) from the Language menu; null means Match my files. */
export function resolveBuildLanguage(chosen: string | null | undefined, sourceText: string): BuildLanguagePlan {
  const source = detectLanguage(sourceText);
  const picked = findLanguage(chosen);
  const output = picked ?? source;
  const converting = picked != null && picked.code !== source?.code;
  const factor = languageFactor(output, sourceText);
  const costFactor = Math.max(factor, languageFactor(source, sourceText));
  return { output, source, converting, factor, costFactor, strings: builderStrings(output) };
}

// ---------------------------------------------------------------------------
// Word matching that works without spaces
// ---------------------------------------------------------------------------

const CJK_RUN = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/gu;

/**
 * Comparable pieces of text for overlap checks. Spaced scripts give words of
 * 4+ letters cut to 5 (so plural and case endings still match); Arabic drops
 * the attached article. CJK and Hangul give character pairs, which survives
 * missing spaces and attached particles.
 */
export function matchTokens(text: string, ignore?: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const run of lower.match(CJK_RUN) ?? []) {
    const chars = [...run];
    for (let i = 0; i + 1 < chars.length; i++) {
      const pair = chars[i]! + chars[i + 1]!;
      if (!ignore?.has(pair)) out.add(pair);
    }
  }
  for (let w of lower.replace(CJK_RUN, " ").split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (ARABIC.test(w)) w = w.replace(/^(وال|بال|كال|فال|لل|ال)/u, "");
    if ([...w].length >= 4 && !ignore?.has(w)) out.add([...w].slice(0, 5).join(""));
  }
  return [...out];
}
