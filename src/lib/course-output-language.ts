export type CourseOutputLanguage =
  | "auto"
  | "en"
  | "ko"
  | "es"
  | "fr"
  | "ja"
  | "zh";

export const DEFAULT_COURSE_OUTPUT_LANGUAGE: CourseOutputLanguage = "auto";

export const COURSE_OUTPUT_LANGUAGE_OPTIONS: {
  value: CourseOutputLanguage;
  label: string;
  description: string;
}[] = [
  {
    value: "auto",
    label: "Match my files",
    description: "Use the main language in your uploads",
  },
  {
    value: "en",
    label: "English",
    description: "Lessons and quizzes in English",
  },
  {
    value: "ko",
    label: "한국어",
    description: "Lessons and quizzes in Korean",
  },
  {
    value: "es",
    label: "Español",
    description: "Lessons and quizzes in Spanish",
  },
  {
    value: "fr",
    label: "Français",
    description: "Lessons and quizzes in French",
  },
  {
    value: "ja",
    label: "日本語",
    description: "Lessons and quizzes in Japanese",
  },
  {
    value: "zh",
    label: "中文",
    description: "Lessons and quizzes in Chinese",
  },
];

const OUTPUT_LANGUAGE_SET = new Set<CourseOutputLanguage>(
  COURSE_OUTPUT_LANGUAGE_OPTIONS.map((o) => o.value)
);

export function parseCourseOutputLanguage(raw: unknown): CourseOutputLanguage {
  if (typeof raw === "string" && OUTPUT_LANGUAGE_SET.has(raw as CourseOutputLanguage)) {
    return raw as CourseOutputLanguage;
  }
  return DEFAULT_COURSE_OUTPUT_LANGUAGE;
}

function languageLabel(lang: Exclude<CourseOutputLanguage, "auto">): string {
  switch (lang) {
    case "en":
      return "English";
    case "ko":
      return "Korean (한국어)";
    case "es":
      return "Spanish (Español)";
    case "fr":
      return "French (Français)";
    case "ja":
      return "Japanese (日本語)";
    case "zh":
      return "Chinese (中文)";
  }
}

/** Prompt block for course outline / module / quiz generation. */
export function formatOutputLanguageGenerationBlock(
  lang: CourseOutputLanguage
): string {
  if (lang === "auto") {
    return `OUTPUT LANGUAGE (required): Detect the **primary language** of the source material. Write ALL student-facing text (lesson content, definitions, examples, quiz questions, choices, explanations, reference answers) in that same language. If the material mixes languages, prefer the language used for the main teaching prose. JSON keys stay in English.`;
  }
  const label = languageLabel(lang);
  return `OUTPUT LANGUAGE (required): Write ALL student-facing text in **${label}** — lesson "content", "key_terms" definitions, "examples", quiz "question" text, MCQ "choices", "explanation", and free-response "reference_answer" rubrics. Use natural, clear ${label} for teaching. JSON keys stay in English; string values are in ${label}. Technical terms from the source may stay in their original language when standard in the field.`;
}

/**
 * Prompt block for Mentored Learning (Rose's spoken + written tutoring).
 * When "auto", Rose matches the language of the course content she receives.
 */
const TEACHING_DEPTH_BLOCK = `
TEACHING DEPTH (required):
- Explain mechanisms and reasoning (why/how), not just labels or greetings.
- Ground every explanation in the source — pathways, drug names, numbers, comparisons.
- After brief transitions, jump into substance; avoid empty filler mid-lesson.`;

const KOREAN_TEACHING_DEPTH_BLOCK = `
KOREAN-SPECIFIC (when teaching in Korean):
- Frame with cause-and-effect (왜 → 어떻게 → 결과).
- Use polite, natural tutoring Korean (합니다체). Keep standard technical terms from the source verbatim.`;

export function formatMentoredTeachingLanguageBlock(
  lang: CourseOutputLanguage
): string {
  if (lang === "auto") {
    return `TEACHING LANGUAGE (required): Speak and write in the **same language as the course content** below (lesson titles, explanations, source text). If the source mixes languages, use the main teaching language and keep mixed drug/technical terms exactly as written in the source (e.g. "디아제팜(diazepam)").${TEACHING_DEPTH_BLOCK}
When the source content is primarily Korean, also:${KOREAN_TEACHING_DEPTH_BLOCK}`;
  }
  const label = languageLabel(lang);
  const depth =
    lang === "ko" ? KOREAN_TEACHING_DEPTH_BLOCK : "";
  return `TEACHING LANGUAGE (required): Speak and write ALL tutoring in **${label}** — greetings, explanations, check questions, replies, and check-ins. The course content below may be in another language; **translate and teach in ${label}** while preserving every proper noun, number, dosage, and table value from the source exactly. Keep mixed-language drug/technical terms in full when they appear in the source (both languages).${TEACHING_DEPTH_BLOCK}${depth}`;
}

/** Map course output language to voice TTS / Whisper language codes. */
export function courseOutputLanguageToVoiceLanguage(
  lang: CourseOutputLanguage
): "auto" | "en" | "es" | "fr" | "ko" | "ja" | "zh" {
  if (lang === "auto") return "auto";
  return lang;
}

/** Prefer an in-session language override from the client when valid. */
export function resolveTeachingLanguage(
  fromCourse: CourseOutputLanguage,
  clientOverride?: unknown
): CourseOutputLanguage {
  if (clientOverride !== undefined && clientOverride !== null) {
    return parseCourseOutputLanguage(clientOverride);
  }
  return fromCourse;
}

type TeachingLang = Exclude<CourseOutputLanguage, "auto">;

function inferLanguageFromSample(text: string): TeachingLang {
  const t = text.trim();
  if (!t) return "en";
  const hangul = (t.match(/[\uac00-\ud7af]/g) ?? []).length;
  const latin = (t.match(/[a-zA-Z]/g) ?? []).length;
  const han = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const kana = (t.match(/[\u3040-\u30ff]/g) ?? []).length;
  if (hangul > latin && hangul >= han) return "ko";
  if (kana > latin) return "ja";
  if (han > latin) return "zh";
  if (/\b(el |la |los |las |qué|cómo|está)\b/i.test(t)) return "es";
  if (/\b(le |la |les |est |une |des )\b/i.test(t)) return "fr";
  return "en";
}

const SOFT_CHECK_BY_LANG: Record<TeachingLang, string[]> = {
  en: [
    "Does that make sense so far?",
    "Still with me on that?",
    "How's that landing — make sense?",
    "Following so far, or want me to go deeper?",
    "That track for you?",
  ],
  ko: [
    "지금까지 이해가 되시나요?",
    "잘 따라오고 계신가요?",
    "어떠세요 — 이해가 되셨나요?",
    "계속 진행해도 될까요, 아니면 더 설명해 드릴까요?",
    "이해가 되셨나요?",
  ],
  es: [
    "¿Tiene sentido hasta ahora?",
    "¿Vas bien con eso?",
    "¿Cómo lo ves — te queda claro?",
    "¿Seguimos o quieres que profundice?",
    "¿Te encaja?",
  ],
  fr: [
    "Est-ce que c'est clair jusqu'ici ?",
    "Tu suis pour l'instant ?",
    "Ça te parle — c'est clair ?",
    "On continue ou tu veux plus de détails ?",
    "Ça te va ?",
  ],
  ja: [
    "ここまで理解できていますか？",
    "ついていけていますか？",
    "いかがでしょうか — わかりましたか？",
    "このまま進めますか、もう少し説明しましょうか？",
    "大丈夫そうですか？",
  ],
  zh: [
    "到目前为止清楚吗？",
    "跟得上吗？",
    "怎么样——理解了吗？",
    "要继续还是我再详细讲讲？",
    "这样可以吗？",
  ],
};

/** Natural check-in after each explanation — localized to the teaching language. */
export function softCheckInLine(
  chunkId: string,
  lang: CourseOutputLanguage,
  contentSample?: string
): string {
  const resolved: TeachingLang =
    lang === "auto" ? inferLanguageFromSample(contentSample ?? "") : lang;
  const pool = SOFT_CHECK_BY_LANG[resolved];
  let h = 0;
  for (let i = 0; i < chunkId.length; i++) {
    h = (h * 31 + chunkId.charCodeAt(i)) >>> 0;
  }
  return pool[h % pool.length]!;
}

const GREETING_FALLBACK: Record<
  TeachingLang,
  {
    first_time: (title: string) => string;
    all_complete: string;
    returning: (last: string) => string;
    generic: string;
  }
> = {
  en: {
    first_time: (title) => `Welcome to ${title}. Ready to dive in?`,
    all_complete:
      "Welcome back — looks like you've already worked through this whole course. Want to review anything specific?",
    returning: (last) =>
      `Welcome back. Last time we were on "${last}". Ready to keep going?`,
    generic: "Welcome back. Ready to keep going?",
  },
  ko: {
    first_time: (title) => `${title}에 오신 것을 환영합니다. 시작할 준비 되셨나요?`,
    all_complete:
      "다시 오셨군요 — 이 과정은 이미 모두 학습하신 것 같아요. 복습하고 싶은 부분이 있나요?",
    returning: (last) =>
      `다시 오셨군요. 지난번에는 "${last}"를 다뤘어요. 이어서 진행할까요?`,
    generic: "다시 오셨군요. 이어서 진행할까요?",
  },
  es: {
    first_time: (title) => `Bienvenido a ${title}. ¿Listo para empezar?`,
    all_complete:
      "Bienvenido de nuevo — parece que ya completaste todo el curso. ¿Quieres repasar algo?",
    returning: (last) =>
      `Bienvenido de nuevo. La última vez vimos "${last}". ¿Seguimos?`,
    generic: "Bienvenido de nuevo. ¿Seguimos?",
  },
  fr: {
    first_time: (title) => `Bienvenue dans ${title}. Prêt à commencer ?`,
    all_complete:
      "Bon retour — tu as déjà terminé tout le cours. Tu veux revoir quelque chose ?",
    returning: (last) =>
      `Bon retour. La dernière fois on était sur « ${last} ». On continue ?`,
    generic: "Bon retour. On continue ?",
  },
  ja: {
    first_time: (title) => `${title}へようこそ。始める準備はできていますか？`,
    all_complete:
      "おかえりなさい — このコースはすでに完了しているようです。復習したいところはありますか？",
    returning: (last) =>
      `おかえりなさい。前回は「${last}」を学びました。続けましょうか？`,
    generic: "おかえりなさい。続けましょうか？",
  },
  zh: {
    first_time: (title) => `欢迎来到${title}。准备好开始了吗？`,
    all_complete: "欢迎回来——你似乎已经学完了整个课程。想复习哪一部分吗？",
    returning: (last) => `欢迎回来。上次我们学习了「${last}」。继续吗？`,
    generic: "欢迎回来。继续吗？",
  },
};

export type SessionReadyAckVariant = "fresh" | "resume";

/** Warm line after the student says they're ready to start the lesson. */
export function sessionReadyAckLine(
  lang: CourseOutputLanguage,
  opts?: {
    contentSample?: string;
    variant?: SessionReadyAckVariant;
    /** Slang / high-energy replies (e.g. "yessurski") — not plain "yes". */
    enthusiastic?: boolean;
  }
): string {
  const resolved: TeachingLang =
    lang === "auto"
      ? inferLanguageFromSample(opts?.contentSample ?? "")
      : lang;
  const variant = opts?.variant ?? "fresh";
  if (variant === "resume") {
    const resume: Record<TeachingLang, string> = {
      en: "Welcome back — let's pick up where we left off.",
      ko: "다시 오셨네요 — 이어서 진행해 볼게요.",
      es: "Bienvenido de nuevo — sigamos donde lo dejamos.",
      fr: "Bon retour — reprenons où nous en étions.",
      ja: "おかえりなさい — 前回の続きから始めましょう。",
      zh: "欢迎回来——我们从上次停下的地方继续。",
    };
    return resume[resolved];
  }
  if (opts?.enthusiastic) {
    const energetic: Record<TeachingLang, string> = {
      en: "Love the energy — let's dive in.",
      ko: "좋아요, 바로 시작해 볼게요.",
      es: "¡Genial — empecemos!",
      fr: "Parfait — on y va.",
      ja: "いいですね、始めましょう。",
      zh: "好，我们开始吧。",
    };
    return energetic[resolved];
  }
  const fresh: Record<TeachingLang, string> = {
    en: "Great — let's get started.",
    ko: "좋아요, 시작해 볼게요.",
    es: "Perfecto — ¡empecemos!",
    fr: "Parfait — on commence.",
    ja: "では、始めましょう。",
    zh: "好，我们开始吧。",
  };
  return fresh[resolved];
}

export function greetingFallbackLine(
  lang: CourseOutputLanguage,
  scenario: "first_time" | "returning" | "all_complete",
  courseTitle: string,
  lastLessonTitle?: string,
  contentSample?: string
): string {
  const resolved: TeachingLang =
    lang === "auto" ? inferLanguageFromSample(contentSample ?? courseTitle) : lang;
  const f = GREETING_FALLBACK[resolved];
  if (scenario === "first_time") return f.first_time(courseTitle);
  if (scenario === "all_complete") return f.all_complete;
  if (scenario === "returning" && lastLessonTitle) {
    return f.returning(lastLessonTitle);
  }
  return f.generic;
}
