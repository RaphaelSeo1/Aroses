import { headingsReferToSameTopic } from "../live-notes/fold-note-markdown.ts";
import type {
  CourseLesson,
  CourseModule,
  CourseQuizItem,
  CourseQuizMcqItem,
} from "../../types/course.ts";
import { isQuizFreeResponse, isQuizMcq } from "../../types/course.ts";

export type NoteFocusSection = {
  index: number;
  heading: string;
  text: string;
  focusClipIds: string[];
};

export type NoteFocusQuestion = {
  id: string;
  item: CourseQuizItem;
  sourceExcerpt: string | null;
};

export type ModuleQuizTarget = {
  id: number;
  title: string;
  quiz: CourseQuizItem[];
  lessonText: string;
};

export type FocusQuestionMapping = {
  itemId: string;
  moduleId: number;
  item: CourseQuizItem;
  /** True when the generated module bank already has this question. */
  duplicateOfGenerated: boolean;
};

type TipTapNode = {
  type?: string;
  text?: string;
  attrs?: { level?: unknown; id?: unknown };
  content?: TipTapNode[];
  marks?: Array<{ type?: string; attrs?: { id?: unknown } }>;
};

const CLIP_MARK = "focusClip";

function nodeText(node: TipTapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(nodeText).join("");
}

function collectClipIds(node: TipTapNode, into: Set<string>): void {
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark?.type !== CLIP_MARK) continue;
      const id = mark.attrs?.id;
      if (typeof id === "string" && id.trim()) into.add(id.trim());
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectClipIds(child, into);
  }
}

function isSectionHeading(node: TipTapNode): boolean {
  if (node.type !== "heading") return false;
  const level = node.attrs?.level;
  return level === 1 || level === 2 || level == null;
}

/**
 * Heading-delimited sections from a notes TipTap doc, including focus-clip
 * ids so cards can follow the passage they were generated from.
 */
export function extractNoteFocusSections(
  contentJson: unknown
): NoteFocusSection[] {
  const doc = contentJson as TipTapNode | null;
  const blocks = Array.isArray(doc?.content) ? doc.content : [];
  if (blocks.length === 0) return [];

  type OpenSection = {
    heading: string;
    parts: string[];
    clipIds: Set<string>;
  };
  const sections: OpenSection[] = [];
  let current: OpenSection | null = null;

  const startSection = (heading: string): OpenSection => {
    const next: OpenSection = { heading, parts: [], clipIds: new Set() };
    current = next;
    sections.push(next);
    return next;
  };

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "horizontalRule") continue;
    const text = nodeText(block).replace(/\s+/g, " ").trim();
    if (isSectionHeading(block) && text) {
      collectClipIds(block, startSection(text.slice(0, 200)).clipIds);
      continue;
    }
    const section = current ?? startSection("");
    if (text) section.parts.push(text);
    collectClipIds(block, section.clipIds);
  }

  return sections
    .map((s, index) => ({
      index,
      heading: s.heading,
      text: [s.heading, ...s.parts].filter(Boolean).join("\n"),
      focusClipIds: [...s.clipIds],
    }))
    .filter((s) => s.text.trim().length > 0 || s.focusClipIds.length > 0);
}

export function modulesToQuizTargets(
  modules: Array<{
    id: number;
    title: string;
    quiz: CourseQuizItem[];
    lessons?: CourseLesson[];
  }>
): ModuleQuizTarget[] {
  return modules.map((mod) => ({
    id: mod.id,
    title: mod.title,
    quiz: mod.quiz,
    lessonText: (mod.lessons ?? [])
      .map((l) => `${l.title}\n${l.content ?? ""}`)
      .join("\n"),
  }));
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function significantPieces(text: string): Set<string> {
  const out = new Set<string>();
  const ascii = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  for (const w of ascii) out.add(w);
  const cjk =
    text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]{2,}/g) ?? [];
  for (const w of cjk) out.add(w);
  return out;
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function overlapScore(query: string, haystack: string): number {
  const q = normalizeMatchText(query);
  const h = normalizeMatchText(haystack);
  if (!q || !h) return 0;
  if (q.length >= 12 && h.includes(q)) return 1;
  if (h.length >= 12 && q.includes(h) && h.length / q.length >= 0.4) return 0.9;
  return tokenJaccard(significantPieces(q), significantPieces(h));
}

export function quizQuestionStem(item: CourseQuizItem): string {
  return normalizeMatchText(item.question);
}

/** Strong match only — false positives would drop student-authored cards. */
export function isSameQuizQuestion(
  a: CourseQuizItem,
  b: CourseQuizItem
): boolean {
  const sa = quizQuestionStem(a);
  const sb = quizQuestionStem(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (sa.length >= 24 && sb.length >= 24 && (sa.includes(sb) || sb.includes(sa))) {
    return true;
  }
  if (tokenJaccard(significantPieces(sa), significantPieces(sb)) < 0.72) {
    return false;
  }
  if (isQuizFreeResponse(a) !== isQuizFreeResponse(b)) return false;
  if (isQuizMcq(a) && isQuizMcq(b)) {
    const ca = normalizeMatchText(a.correct);
    const cb = normalizeMatchText(b.correct);
    if (ca && cb && ca === cb) return true;
  }
  return sa.length >= 20 && sb.length >= 20;
}

export function cloneQuizItem(item: CourseQuizItem): CourseQuizItem {
  if (isQuizFreeResponse(item)) {
    return { ...item };
  }
  const mcq = item as CourseQuizMcqItem;
  return {
    ...mcq,
    choices: [...mcq.choices] as CourseQuizMcqItem["choices"],
  };
}

function sectionForQuestion(
  question: NoteFocusQuestion,
  sections: NoteFocusSection[]
): NoteFocusSection | null {
  if (sections.length === 0) return null;
  for (const section of sections) {
    if (section.focusClipIds.includes(question.id)) return section;
  }
  const excerpt = question.sourceExcerpt?.replace(/\s+/g, " ").trim() ?? "";
  if (excerpt.length >= 12) {
    let best: NoteFocusSection | null = null;
    let bestScore = 0;
    for (const section of sections) {
      const score = overlapScore(excerpt, section.text);
      if (score > bestScore) {
        bestScore = score;
        best = section;
      }
    }
    if (best && bestScore >= 0.28) return best;
  }
  const qText = `${question.item.question} ${excerpt}`.trim();
  let best: NoteFocusSection | null = null;
  let bestScore = 0;
  for (const section of sections) {
    const score = overlapScore(qText, section.text);
    if (score > bestScore) {
      bestScore = score;
      best = section;
    }
  }
  if (best && bestScore >= 0.34) return best;
  return null;
}

function moduleIndexForSection(
  section: NoteFocusSection,
  modules: ModuleQuizTarget[],
  sectionCount: number
): number {
  if (modules.length === 1) return 0;
  if (section.heading) {
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i]!;
      if (headingsReferToSameTopic(section.heading, mod.title)) return i;
      const lessonHead = mod.lessonText.split("\n")[0] ?? "";
      if (lessonHead && headingsReferToSameTopic(section.heading, lessonHead)) {
        return i;
      }
    }
  }
  let bestIdx = -1;
  let bestScore = 0;
  const query = `${section.heading}\n${section.text}`;
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i]!;
    const hay = `${mod.title}\n${mod.lessonText}`;
    const score = overlapScore(query, hay);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestScore >= 0.22) return bestIdx;
  return orderFallbackIndex(section.index, sectionCount, modules.length);
}

function orderFallbackIndex(
  sectionIndex: number,
  sectionCount: number,
  moduleCount: number
): number {
  if (moduleCount <= 1) return 0;
  if (sectionCount <= 1) return 0;
  return Math.min(
    moduleCount - 1,
    Math.floor((sectionIndex * moduleCount) / sectionCount)
  );
}

function contentMatchModuleIndex(
  question: NoteFocusQuestion,
  modules: ModuleQuizTarget[]
): number | null {
  if (modules.length <= 1) return 0;
  const query = `${question.sourceExcerpt ?? ""}\n${question.item.question}`;
  let bestIdx = 0;
  let bestScore = 0;
  let second = 0;
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i]!;
    const score = overlapScore(query, `${mod.title}\n${mod.lessonText}`);
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      bestIdx = i;
    } else if (score > second) {
      second = score;
    }
  }
  if (bestScore >= 0.28 && bestScore - second >= 0.06) return bestIdx;
  return null;
}

/**
 * Assign note-sourced focus cards to course modules. One module → all cards
 * go there. Several modules → heading / clip / excerpt / order, not a dump
 * onto module 1 when the note has section structure.
 */
export function mapFocusQuestionsToModules(opts: {
  questions: NoteFocusQuestion[];
  modules: ModuleQuizTarget[];
  noteSections: NoteFocusSection[];
}): FocusQuestionMapping[] {
  const { questions, modules, noteSections } = opts;
  if (questions.length === 0 || modules.length === 0) return [];

  const onlyModule = modules.length === 1 ? modules[0]! : null;
  const out: FocusQuestionMapping[] = [];

  for (const question of questions) {
    let moduleId: number;
    if (onlyModule) {
      moduleId = onlyModule.id;
    } else {
      const section = sectionForQuestion(question, noteSections);
      if (section) {
        const idx = moduleIndexForSection(
          section,
          modules,
          noteSections.length
        );
        moduleId = modules[idx]?.id ?? modules[0]!.id;
      } else {
        const matched = contentMatchModuleIndex(question, modules);
        moduleId =
          matched != null
            ? modules[matched]!.id
            : noteSections.length > 1
              ? modules[
                  orderFallbackIndex(
                    out.length,
                    Math.max(questions.length, 1),
                    modules.length
                  )
                ]!.id
              : modules[0]!.id;
      }
    }

    const target = modules.find((m) => m.id === moduleId) ?? modules[0]!;
    out.push({
      itemId: question.id,
      moduleId: target.id,
      item: question.item,
      duplicateOfGenerated: target.quiz.some((q) =>
        isSameQuizQuestion(q, question.item)
      ),
    });
  }

  return out;
}

export function mergeFocusQuestionsIntoModuleQuizzes(
  modules: CourseModule[],
  mappings: FocusQuestionMapping[]
): CourseModule[] {
  if (mappings.length === 0) return modules;
  const extras = new Map<number, CourseQuizItem[]>();
  for (const mapping of mappings) {
    if (mapping.duplicateOfGenerated) continue;
    const list = extras.get(mapping.moduleId) ?? [];
    if (list.some((q) => isSameQuizQuestion(q, mapping.item))) continue;
    list.push(cloneQuizItem(mapping.item));
    extras.set(mapping.moduleId, list);
  }
  if (extras.size === 0) return modules;

  return modules.map((mod) => {
    const add = extras.get(mod.id);
    if (!add || add.length === 0) return mod;
    const quiz = [...mod.quiz];
    for (const item of add) {
      if (quiz.some((q) => isSameQuizQuestion(q, item))) continue;
      quiz.push(item);
    }
    return quiz.length === mod.quiz.length ? mod : { ...mod, quiz };
  });
}

export function planFocusQuestionImport(opts: {
  questions: NoteFocusQuestion[];
  modules: CourseModule[];
  contentJson: unknown;
}): { mappings: FocusQuestionMapping[]; modules: CourseModule[] } {
  const noteSections = extractNoteFocusSections(opts.contentJson);
  const mappings = mapFocusQuestionsToModules({
    questions: opts.questions,
    modules: modulesToQuizTargets(opts.modules),
    noteSections,
  });
  return {
    mappings,
    modules: mergeFocusQuestionsIntoModuleQuizzes(opts.modules, mappings),
  };
}
