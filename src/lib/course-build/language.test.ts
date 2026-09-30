import assert from "node:assert/strict";
import { test } from "node:test";
import { paginateText } from "./clean.ts";
import { confirmedBy, figureCaption, type FigureAsset } from "./figures.ts";
import { buildLanguage, planLanguageLine } from "./handlers.ts";
import {
  BUILD_LANGUAGE_OPTIONS,
  builderStrings,
  contentLength,
  detectLanguage,
  findLanguage,
  languageByCode,
  languageFactor,
  matchTokens,
  resolveBuildLanguage,
  visibleLength,
  wordCount,
} from "./language.ts";
import { languageLine, lengthUnit, lessonWordBudget, toCourseModule, writtenStrings } from "./module.ts";
import { pageWeight, type BuildPage } from "./outline.ts";
import { moduleMaxTokens, moduleTargetTokens, repairPlan } from "./plan.ts";
import { buildSpendCapUsd, estimateTextTokens } from "./pricing.ts";
import { readCourseBuildConfig } from "./config.ts";

const SAMPLES: Record<string, string> = {
  en: "Enzymes speed up chemical reactions by lowering the activation energy. Each enzyme binds a specific substrate at its active site. Temperature and pH change the shape of the active site, so every enzyme works best within a narrow range. Competitive inhibitors block the active site, while noncompetitive inhibitors bind elsewhere and change the enzyme's shape.",
  es: "Las enzimas aceleran las reacciones químicas al reducir la energía de activación. Cada enzima se une a un sustrato específico en su sitio activo. La temperatura y el pH cambian la forma del sitio activo, por lo que cada enzima funciona mejor dentro de un rango estrecho. Los inhibidores competitivos bloquean el sitio activo, mientras que los no competitivos se unen en otro lugar y cambian la forma de la enzima.",
  fr: "Les enzymes accélèrent les réactions chimiques en abaissant l'énergie d'activation. Chaque enzyme se lie à un substrat spécifique au niveau de son site actif. La température et le pH modifient la forme du site actif, de sorte que chaque enzyme fonctionne au mieux dans une plage étroite. Les inhibiteurs compétitifs bloquent le site actif, tandis que les inhibiteurs non compétitifs se fixent ailleurs et modifient la forme de l'enzyme.",
  de: "Enzyme beschleunigen chemische Reaktionen, indem sie die Aktivierungsenergie senken. Jedes Enzym bindet ein bestimmtes Substrat an seinem aktiven Zentrum. Temperatur und pH-Wert verändern die Form des aktiven Zentrums, daher arbeitet jedes Enzym in einem engen Bereich am besten. Kompetitive Hemmstoffe blockieren das aktive Zentrum, während nichtkompetitive Hemmstoffe an anderer Stelle binden und die Form des Enzyms verändern.",
  pt: "As enzimas aceleram as reações químicas ao reduzir a energia de ativação. Cada enzima liga-se a um substrato específico no seu sítio ativo. A temperatura e o pH alteram a forma do sítio ativo, por isso cada enzima funciona melhor dentro de uma faixa estreita. Os inibidores competitivos bloqueiam o sítio ativo, enquanto os não competitivos se ligam noutro local e alteram a forma da enzima.",
  it: "Gli enzimi accelerano le reazioni chimiche abbassando l'energia di attivazione. Ogni enzima lega un substrato specifico nel suo sito attivo. La temperatura e il pH cambiano la forma del sito attivo, quindi ogni enzima funziona meglio entro un intervallo ristretto. Gli inibitori competitivi bloccano il sito attivo, mentre quelli non competitivi si legano altrove e cambiano la forma dell'enzima.",
  ru: "Ферменты ускоряют химические реакции, снижая энергию активации. Каждый фермент связывает определённый субстрат в своём активном центре. Температура и pH изменяют форму активного центра, поэтому каждый фермент лучше всего работает в узком диапазоне.",
  tr: "Enzimler, aktivasyon enerjisini düşürerek kimyasal tepkimeleri hızlandırır. Her enzim, aktif bölgesinde belirli bir substrata bağlanır. Sıcaklık ve pH aktif bölgenin şeklini değiştirir, bu yüzden her enzim dar bir aralıkta en iyi çalışır. Yarışmalı inhibitörler aktif bölgeyi engellerken, yarışmasız inhibitörler başka bir yere bağlanır ve enzimin şeklini değiştirir.",
  vi: "Enzyme làm tăng tốc các phản ứng hóa học bằng cách giảm năng lượng hoạt hóa. Mỗi enzyme gắn với một cơ chất đặc hiệu tại vị trí hoạt động của nó. Nhiệt độ và pH làm thay đổi hình dạng của vị trí hoạt động.",
  id: "Enzim mempercepat reaksi kimia dengan menurunkan energi aktivasi. Setiap enzim mengikat substrat tertentu di situs aktifnya. Suhu dan pH mengubah bentuk situs aktif, sehingga setiap enzim bekerja paling baik dalam rentang yang sempit. Inhibitor kompetitif menghalangi situs aktif, sedangkan inhibitor nonkompetitif berikatan di tempat lain dan mengubah bentuk enzim.",
  hi: "एंजाइम सक्रियण ऊर्जा को कम करके रासायनिक अभिक्रियाओं को तेज़ करते हैं। प्रत्येक एंजाइम अपने सक्रिय स्थल पर एक विशिष्ट सब्सट्रेट से जुड़ता है। तापमान और pH सक्रिय स्थल का आकार बदल देते हैं, इसलिए प्रत्येक एंजाइम एक संकीर्ण सीमा में सबसे अच्छा काम करता है।",
  ar: "تسرّع الإنزيمات التفاعلات الكيميائية عن طريق خفض طاقة التنشيط. يرتبط كل إنزيم بركيزة محددة في موقعه النشط. تغيّر درجة الحرارة ودرجة الحموضة شكل الموقع النشط، لذلك يعمل كل إنزيم بأفضل شكل ضمن نطاق ضيق.",
  fa: "آنزیم‌ها واکنش‌های شیمیایی را با کاهش انرژی فعال‌سازی سرعت می‌بخشند. هر آنزیم به یک پیش‌ماده ویژه در جایگاه فعال خود متصل می‌شود. دما و pH شکل جایگاه فعال را تغییر می‌دهند، بنابراین هر آنزیم در محدوده‌ای باریک بهترین کار را می‌کند.",
  ur: "خامرے فعال سازی کی توانائی کم کر کے کیمیائی تعاملات کو تیز کرتے ہیں۔ ہر خامرہ اپنی فعال جگہ پر ایک مخصوص مادے سے جڑتا ہے۔ درجہ حرارت اور pH فعال جگہ کی شکل بدل دیتے ہیں، اس لیے ہر خامرہ ایک تنگ حد میں بہترین کام کرتا ہے۔",
  uk: "Ферменти прискорюють хімічні реакції, знижуючи енергію активації. Кожен фермент зв'язує певний субстрат у своєму активному центрі, і температура змінює його форму, тому кожен фермент найкраще працює у вузькому діапазоні.",
  ko: "효소는 활성화 에너지를 낮추어 화학 반응을 빠르게 한다. 각 효소는 활성 부위에서 특정 기질과 결합한다. 온도와 pH는 활성 부위의 모양을 바꾸므로 모든 효소는 좁은 범위에서 가장 잘 작용한다.",
  ja: "酵素は活性化エネルギーを下げることで化学反応を速める。各酵素は活性部位で特定の基質と結合する。温度とpHは活性部位の形を変えるため、どの酵素も狭い範囲で最もよく働く。",
  zh: "酶通过降低活化能来加快化学反应。每种酶在其活性位点与特定的底物结合。温度和pH会改变活性位点的形状，因此每种酶在狭窄的范围内效果最好。",
  "zh-Hant": "酶透過降低活化能來加快化學反應。每種酶在其活性位點與特定的受質結合。溫度和pH會改變活性位點的形狀，因此每種酶在狹窄的範圍內效果最好。",
};

test("detects each offered language from a paragraph of source text", () => {
  for (const [code, text] of Object.entries(SAMPLES)) {
    assert.equal(detectLanguage(text)?.code, code, `expected ${code}`);
  }
});

test("detection: English terms inside Korean notes stay Korean; unclear text is left to the writer", () => {
  const mixed =
    "디아제팜(diazepam)은 벤조디아제핀(benzodiazepine) 계열로 GABA-A receptor에 결합하여 Cl- 유입을 증가시킨다. 로라제팜(lorazepam)과 미다졸람(midazolam)도 같은 기전으로 작용한다.";
  assert.equal(detectLanguage(mixed)?.code, "ko");
  assert.equal(detectLanguage("ATP ADP NADH FADH2 Krebs"), null);
  const serbian = "Ензими убрзавају хемијске реакције смањујући енергију активације. Сваки ензим везује одређени супстрат у свом активном центру, а температура мења његов облик. Његова структура је најважнија за функцију.";
  assert.equal(detectLanguage(serbian), null);
});

test("the menu lists every language in its own script, Match my files first", () => {
  assert.equal(BUILD_LANGUAGE_OPTIONS[0]!.value, "auto");
  assert.equal(BUILD_LANGUAGE_OPTIONS[0]!.label, "Match my files");
  const labels = BUILD_LANGUAGE_OPTIONS.map((o) => o.label);
  for (const l of ["English", "한국어", "Español", "Français", "日本語", "Deutsch", "Português", "Italiano", "Tiếng Việt", "हिन्दी", "العربية"]) {
    assert.ok(labels.includes(l), l);
  }
  assert.equal(languageByCode("de")?.name, "German");
  assert.equal(languageByCode("auto"), null);
  assert.equal(findLanguage("Chinese")?.code, "zh", "names stored by older builds still resolve");
  assert.equal(findLanguage("Korean")?.code, "ko");
  assert.equal(languageByCode("ar")?.dir, "rtl");
  assert.equal(languageByCode("fa")?.dir, "rtl");
  assert.equal(languageByCode("ur")?.dir, "rtl");
  for (const l of ["فارسی", "اردو", "Українська"]) assert.ok(labels.includes(l), l);
});

test("resolving a build: Match my files follows the files; a choice that differs is a conversion", () => {
  const auto = resolveBuildLanguage(null, SAMPLES.es!);
  assert.equal(auto.output?.code, "es");
  assert.equal(auto.converting, false);
  assert.equal(auto.strings.module(2), "Módulo 2");

  const toArabic = resolveBuildLanguage("Arabic", SAMPLES.en!);
  assert.equal(toArabic.output?.code, "ar");
  assert.equal(toArabic.source?.code, "en");
  assert.equal(toArabic.converting, true);
  assert.equal(toArabic.factor, 2);

  const same = resolveBuildLanguage("Japanese", SAMPLES.ja!);
  assert.equal(same.converting, false);

  const unknown = resolveBuildLanguage(null, "ATP NADH FADH2");
  assert.equal(unknown.output, null);
  assert.equal(unknown.strings.untitled, "Untitled material");
});

test("a source in no recognised language gets labels in the language the writer wrote", () => {
  const lesson = { lessons: [{ title: "Ензими", content: SAMPLES.uk }] };
  assert.equal(writtenStrings(lesson).module(1), "Модуль 1");
  assert.equal(writtenStrings({ lessons: [{ title: "ATP", content: "NADH FADH2" }] }).module(1), "Module 1");
  assert.equal(writtenStrings({ lessons: [{ title: "", content: SAMPLES.fa }] }).locator("page", 2, 4), "صفحات 2–4");
});

test("language factor: measured token cost vs English, between 1 and 2", () => {
  assert.equal(languageFactor(languageByCode("en")), 1);
  assert.equal(languageFactor(languageByCode("es")), 1.56);
  assert.equal(languageFactor(languageByCode("hi")), 2);
  assert.equal(languageFactor(null, "mostly latin text here"), 1.6);
  assert.equal(languageFactor(null, "مرحبا بالعالم"), 2);
  // An English course from a Korean source writes English-sized output but pays for the Korean input.
  const koToEn = resolveBuildLanguage("English", SAMPLES.ko!);
  assert.equal(koToEn.factor, 1);
  assert.equal(koToEn.costFactor, languageFactor(languageByCode("ko")));
});

test("budgets: targets and caps grow with the language factor; English is unchanged", () => {
  const cfg = { outputTokensPerPage: 200 };
  assert.equal(moduleTargetTokens(10, cfg), 2000);
  assert.equal(moduleTargetTokens(10, { ...cfg, languageFactor: 2 }), 4000);
  assert.equal(moduleTargetTokens(3, { ...cfg, languageFactor: 1.5 }), 2100);
  assert.equal(moduleMaxTokens(10, { ...cfg, languageFactor: 2 }), 6000);
  const c = readCourseBuildConfig({});
  assert.equal(buildSpendCapUsd(40, c), 0.1);
  assert.equal(buildSpendCapUsd(40, c, 1.56), 0.156);
  assert.equal(buildSpendCapUsd(40, c, 9), 0.2, "never more than double");
  assert.equal(buildSpendCapUsd(2, c, 2), 0.06, "floor still applies");
});

test("module boundaries are the same in every language; only the token budget grows", () => {
  const pages: BuildPage[] = Array.from({ length: 16 }, (_, i) => ({
    g: i + 1,
    sourceIndex: 0,
    n: i + 1,
    text: `Topic ${i + 1}. ${"Dense explanatory sentence about the topic. ".repeat(12)}`,
  }));
  const raw = { modules: [{ title: "All", first_page: 1 }] };
  const en = repairPlan(raw, pages, { outputTokensPerPage: 200 });
  const ko = repairPlan(raw, pages, {
    outputTokensPerPage: 200,
    languageFactor: 2,
    strings: builderStrings(languageByCode("ko")),
  });
  assert.deepEqual(
    ko.modules.map((m) => m.pages),
    en.modules.map((m) => m.pages)
  );
  assert.equal(ko.modules[0]!.targetTokens, en.modules[0]!.targetTokens * 2);
  assert.equal(ko.modules[0]!.quizCount, en.modules[0]!.quizCount);
});

test("lesson length: words for spaced languages, characters for Chinese and Japanese, quiz room scaled", () => {
  assert.equal(lessonWordBudget(2400, 7, 3), 930, "English budget unchanged");
  const ko = lengthUnit(resolveBuildLanguage("Korean", SAMPLES.ko!));
  assert.equal(ko.unit, "word");
  // Same token target as English: the quiz takes 2.45x... capped at 2x, and Korean words cost 4.45 tokens.
  assert.equal(lessonWordBudget(4800, 7, 3, ko), Math.round((4800 - (7 * 105 + 3 * 110) * 2 - 80) / 4.45 / 10) * 10);
  const ja = lengthUnit(resolveBuildLanguage("Japanese", SAMPLES.ja!));
  assert.equal(ja.unit, "char");
  assert.equal(lessonWordBudget(4000, 7, 3, ja), Math.round((4000 - (7 * 105 + 3 * 110) * 1.8 - 80) / 1.1 / 10) * 10);
  const line = languageLine(resolveBuildLanguage("Japanese", SAMPLES.en!));
  assert.match(line, /in Japanese/);
  assert.match(line, /translate faithfully/);
  assert.match(line, /two characters as one word/);
  assert.equal(languageLine(resolveBuildLanguage(null, "ATP NADH")), "Write in the language of the pages.");
});

test("planner is told the language explicitly, including under Match my files", () => {
  const pages = (text: string): BuildPage[] => [{ g: 1, sourceIndex: 0, n: 1, text }];
  assert.match(planLanguageLine(buildLanguage(null, pages(SAMPLES.it!))), /titles in Italian\.\n$/);
  assert.match(planLanguageLine(buildLanguage("Vietnamese", pages(SAMPLES.en!))), /in Vietnamese, translating/);
  assert.equal(planLanguageLine(buildLanguage(null, pages("ATP NADH"))), "");
});

test("page weight and pagination count Chinese and Japanese by content, not by spaces", () => {
  assert.ok(contentLength(SAMPLES.zh!) > [...SAMPLES.zh!].length * 3);
  assert.equal(pageWeight(SAMPLES.zh!.slice(0, 20)), 0.5, "20 Chinese characters is a short line, not an empty page");
  const zhWords = wordCount(SAMPLES.zh!);
  assert.ok(zhWords > 25 && zhWords < 50, `zh words ${zhWords}`); // the English version of these three sentences is 38 words
  assert.equal(wordCount("one two three"), 3);
  const long = Array.from({ length: 60 }, () => SAMPLES.zh!).join("");
  const pages = paginateText(long, 500);
  assert.ok(pages.length >= 3, `expected several pages, got ${pages.length}`);
  const hindi = Array.from({ length: 40 }, () => SAMPLES.hi!).join(" ");
  assert.ok(paginateText(hindi, 500).length >= 3);
});

test("short-text checks count a CJK character as two", () => {
  assert.equal(visibleLength("什么是酶"), 8);
  assert.equal(visibleLength("abc"), 3);
});

test("caption matching works without spaces and with attached particles or articles", () => {
  assert.ok(confirmedBy("세포막의 구조", "세포막은 인지질 이중층 구조로 되어 있다"));
  assert.ok(confirmedBy("细胞膜的结构", "细胞膜由磷脂双分子层构成，其结构具有流动性。"));
  assert.ok(!confirmedBy("线粒体的功能", "细胞膜由磷脂双分子层构成。"));
  assert.ok(confirmedBy("الموقع النشط للإنزيم", "يرتبط كل إنزيم بركيزة محددة في موقعه النشط"));
  assert.deepEqual(matchTokens("图表 细胞", new Set(["图表"])), ["细胞"]);
});

const figure = (over: Partial<FigureAsset> = {}): FigureAsset => ({
  id: "F1",
  g: 2,
  sourceIndex: 0,
  page: 2,
  kind: "diagram",
  url: "https://x/F1.png",
  label: "",
  description: "",
  width: 600,
  height: 400,
  ...over,
});

test("converting: the source's caption isn't shown; the writer's translation is kept only when it had something confirmed", () => {
  const page = "Figure 3. Lipid bilayer\nThe membrane has 2 layers of phospholipids.";
  const labelled = figure({ label: "Figure 3. Lipid bilayer" });
  assert.equal(figureCaption(labelled, "Bicapa lipídica", page), "Figure 3. Lipid bilayer");
  assert.equal(figureCaption(labelled, "Bicapa lipídica", page, { converting: true }), "Bicapa lipídica");
  assert.equal(figureCaption(labelled, "Bicapa lipídica con 5 capas", page, { converting: true }), "", "invented number");
  const bare = figure();
  assert.equal(figureCaption(bare, "Bicapa lipídica", page, { converting: true }), "", "nothing confirmed to translate");
  const described = figure({ description: "lipid bilayer phospholipids" });
  assert.equal(figureCaption(described, "Bicapa de fosfolípidos", page, { converting: true }), "Bicapa de fosfolípidos");
});

test("builder strings are localized: sources, neutral figure caption, quiz fallback, titles", () => {
  const ko = builderStrings(languageByCode("ko"));
  assert.equal(ko.locator("page", 3, 5), "3–5쪽");
  assert.equal(builderStrings(languageByCode("de")).locator("slide", 4, 4), "Folie 4");
  assert.equal(builderStrings(languageByCode("zh")).figureFromPage(7), "来自文件第7页");
  assert.equal(builderStrings(languageByCode("ar")).figureFromPage(7), "من الصفحة 7 في ملفك");
  assert.equal(builderStrings(null).figureFromPage(7), "From page 7 of your file");
});

test("a French module from English pages: localized sources, neutral captions and quiz fallback", () => {
  const pages: BuildPage[] = [
    { g: 1, sourceIndex: 0, n: 1, text: SAMPLES.en! },
    { g: 2, sourceIndex: 0, n: 2, text: `${SAMPLES.en} A second page about inhibitors.` },
  ];
  const plan = repairPlan({ modules: [{ title: "Enzymes", first_page: 1 }] }, pages, { outputTokensPerPage: 200 });
  const { module } = toCourseModule(
    {
      lessons: [
        {
          title: "Les enzymes",
          content: "Les enzymes abaissent l'énergie d'activation.\n\nChaque enzyme se lie à un substrat précis.",
          first_page: 1,
          last_page: 2,
          key_terms: [{ term: "Substrat", definition: "Molécule sur laquelle agit une enzyme." }],
          figures: [{ id: "F1", caption: "Schéma d'une enzyme" }],
        },
      ],
      quiz: [
        { kind: "multiple_choice", question: "Que fait une enzyme ?", choices: ["A", "B", "C", "D"], correct_choice: 1, explanation: "" },
        { kind: "multiple_choice", question: "Où se lie le substrat ?", choices: ["W", "X", "Y", "Z"], correct_choice: 0, explanation: "Au site actif." },
        { kind: "free_response", question: "Expliquez l'inhibition.", reference_answer: "Blocage du site actif.", explanation: "Voir la leçon." },
      ],
    },
    {
      module: { ...plan.modules[0]!, quizCount: 3 },
      pages,
      sources: [{ index: 0, label: "lec.pdf", kind: "pdf", pages: [] }],
      figures: [figure()],
      outputLanguage: "French",
    },
    "Enzymes"
  );
  const lesson = module.lessons[0]!;
  assert.deepEqual(lesson.sources, [{ fileName: "lec.pdf", locator: "pages 1–2" }]);
  assert.equal(lesson.visual_assets?.[0]?.caption, "Tiré de la page 2 de ton fichier");
  assert.equal(module.quiz[0]!.explanation, "Revois les leçons du module sur cette notion.");
});

test("Chinese quiz items and one-character key terms are not dropped as too short", () => {
  const pages: BuildPage[] = [{ g: 1, sourceIndex: 0, n: 1, text: SAMPLES.zh!.repeat(3) }];
  const plan = repairPlan({ modules: [{ title: "酶", first_page: 1 }] }, pages, { outputTokensPerPage: 200 });
  const { module } = toCourseModule(
    {
      lessons: [
        {
          title: "酶的作用",
          content: "酶通过降低活化能来加快化学反应。每种酶在其活性位点与特定的底物结合。",
          first_page: 1,
          last_page: 1,
          key_terms: [{ term: "酶", definition: "生物催化剂。" }],
        },
      ],
      quiz: [
        { kind: "multiple_choice", question: "酶的作用？", choices: ["降低活化能", "提高温度", "改变pH", "增加底物"], correct_choice: 0, explanation: "" },
        { kind: "multiple_choice", question: "底物在哪结合？", choices: ["活性位点", "细胞膜", "细胞核", "线粒体"], correct_choice: 0, explanation: "活性位点。" },
        { kind: "free_response", question: "什么是抑制剂？", reference_answer: "阻断活性位点", explanation: "见课程。" },
      ],
    },
    { module: { ...plan.modules[0]!, quizCount: 3 }, pages, sources: [{ index: 0, label: "讲义.pdf", kind: "pdf", pages: [] }] },
    "酶"
  );
  assert.equal(module.lessons[0]!.key_terms[0]!.term, "酶");
  assert.equal(module.quiz.length, 3);
  assert.equal(module.quiz[0]!.explanation, "请复习本模块中关于这一概念的课程。");
  assert.deepEqual(module.lessons[0]!.sources, [{ fileName: "讲义.pdf", locator: "第1页" }]);
});

test("input token estimate stays at or above the measured Haiku count for dense scripts", () => {
  // Measured with count_tokens on Haiku 4.5: zh 115, ko 174 (at 1.07/char), en 71.
  assert.ok(estimateTextTokens(SAMPLES.zh!) >= 115 * (SAMPLES.zh!.length / 103) * 0.99);
  assert.ok(estimateTextTokens(SAMPLES.en!) >= 71);
  const ko = SAMPLES.ko!;
  assert.ok(estimateTextTokens(ko) >= [...ko].length * 1.07 * 0.95);
});
