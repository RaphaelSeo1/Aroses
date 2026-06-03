/**
 * "Honest FAQ" copy for /help — straight answers, no hype.
 * Keep product-specific facts (pricing, privacy links) in sync with plans + legal pages.
 */

import { PLANS } from "@/lib/billing/plans";

export type HonestFaqItem = {
  id: string;
  question: string;
  paragraphs: string[];
  bullets?: string[];
};

const pricingParagraph = `You're not paying for access to AI — that's commoditized. You're paying for the parts that turn AI into a study routine you'll actually follow: course-structured lessons, persistent spaced repetition, progress tracking, and not having to engineer prompts. **Free** includes ${PLANS.free.highlights[0].toLowerCase()} plus unlimited text tutoring, course building, quizzes, and SRS. **Student** is $${PLANS.student.priceMonthly}/month (${PLANS.student.voiceHours} hours of voice/month). **Premium** is $${PLANS.premium.priceMonthly}/month (${PLANS.premium.voiceHours} hours of voice/month). Voice caps switch you to text — never a hard block mid-study. Optional voice top-ups are planned (~$8/hour). If you have the discipline to rebuild all of this yourself with free tools every session, you may not need us. Most people don't, and that's who Aroses is for.`;

export const HONEST_FAQ_INTRO = {
  title: "Honest FAQ",
  subtitle:
    "Straight answers to the questions skeptical students actually ask. No hype.",
};

export const HONEST_FAQ_ITEMS: HonestFaqItem[] = [
  {
    id: "vs-chatgpt",
    question: "What's the difference between Aroses and just using ChatGPT or Claude?",
    paragraphs: [
      "A general chatbot gives you an answer. Aroses is built to make you actually retain it. The model underneath is similar — the difference is the system around it: your lessons are built from your own course materials, your wrong answers get turned into spaced-repetition flashcards that resurface before your exam, and everything lives in one place that tracks what you've covered. A chatbot forgets you the moment you close the tab.",
      "Short version: **use ChatGPT when you want a quick answer; use Aroses when you want the material to stick.**",
    ],
  },
  {
    id: "upload-to-chatgpt",
    question: "Can't I just upload my lecture notes to ChatGPT and ask it to teach me?",
    paragraphs: [
      "Honestly — yes, you can, and for a single session it'll do a decent job. We're not going to pretend otherwise. The difference is what happens *after* that session:",
    ],
    bullets: [
      "ChatGPT forgets everything when you close the chat. Aroses remembers what you struggled with and brings it back on a schedule.",
      "To make ChatGPT behave like a real tutor (explain in chunks, quiz you, make you recall instead of handing you the answer), *you* have to write that prompt well, every time, for every course. Aroses has that built in and applies it consistently.",
      "The easiest thing to do in a chatbot is ask for the answer and copy it down. That feels like studying but isn't. Aroses' default makes you do the recall.",
      "You're paying for a structured system that just works, not for something the AI \"can't\" do.",
    ],
  },
  {
    id: "accuracy",
    question: "How do I know the lessons are accurate? Doesn't AI make things up?",
    paragraphs: [
      "AI can get things wrong — that's true of every tool in this category, including us. Two things reduce it: lessons are generated from *your* uploaded material rather than generic internet knowledge, which keeps them closer to what your professor actually taught; and the format encourages you to check understanding rather than passively trust. That said, treat Aroses as a study aid, not gospel. If something contradicts your textbook or lecturer, your lecturer wins. We'd rather tell you that than overpromise.",
    ],
  },
  {
    id: "why-pay",
    question: "Why pay when ChatGPT and Claude have free versions?",
    paragraphs: [pricingParagraph],
  },
  {
    id: "vs-anki",
    question: "Isn't this just Anki or Quizlet with extra steps?",
    paragraphs: [
      "There's overlap — the flashcards use the same spaced-repetition principle Anki does, and Anki is free and excellent. The difference is the cards aren't made manually by you; they're generated from your course and, more importantly, from the specific questions you got wrong while learning. So instead of building decks, you study, and the review system fills itself in around your weak spots. If you already love making Anki decks by hand, you might not need that. If you never quite kept up with it, that's the gap we fill.",
    ],
  },
  {
    id: "grades",
    question: "Will this actually improve my grades?",
    paragraphs: [
      "We can't promise a grade — anyone who does is selling you something. What we can say is that the methods Aroses is built on (active recall and spaced repetition) are among the most well-supported study techniques in the research. Whether they raise *your* grade depends on you using the tool consistently. We'd rather set that expectation honestly than make a claim we can't back.",
    ],
  },
  {
    id: "cheating",
    question: "Is using AI to study basically cheating?",
    paragraphs: [
      "No — there's a real line, and Aroses sits on the right side of it. Having AI write your essay and submitting it is cheating. Using AI to explain a concept, quiz you, and drill you until you understand it is just tutoring, which students have paid humans for forever. Aroses is designed around making *you* do the recall, not doing the work for you. (That said, follow your own school's AI policy — those vary.)",
    ],
  },
  {
    id: "privacy",
    question: "What happens to my lecture materials? Is my data private?",
    paragraphs: [
      "Your uploads and generated courses are stored in your account so you can resume studying — they're not posted publicly unless you explicitly list a course on Explore (title + description only; your raw files stay private). We send content to AI providers (e.g. Anthropic) to generate lessons and tutor replies; we don't use your materials to train those models. For the full picture — what's collected, retention, deletion, and third parties — read our [Privacy Policy](/legal/privacy). You can delete your account and associated data from Profile settings; if anything's unclear there, email us and we'll answer plainly.",
    ],
  },
  {
    id: "niche-courses",
    question: "What if my course is really niche, or my PDFs are messy?",
    paragraphs: [
      "Aroses works best with reasonably clean, text-based materials. Very niche subjects can still work because lessons are built from your own files, not from how common the topic is online. The honest caveat: scanned or poorly formatted PDFs can produce weaker results, since the tool can only work with what it can read. If a course comes out rough, that's usually an input-quality issue, and cleaner source material fixes most of it.",
    ],
  },
  {
    id: "cancel",
    question: "What happens to my courses and progress if I stop paying or the app shuts down?",
    paragraphs: [
      "If you cancel a paid plan, you keep your account on the **Free** tier — your courses, notes, quiz history, and SRS cards stay unless you delete them. Voice drops to the free monthly allowance; everything else (text tutoring, building, quizzes, review) stays available. We don't have a one-click \"export entire course as PDF\" yet; you can copy lesson text and download tutor session recaps where that feature exists. We're building toward better portability — your stuff should never feel held hostage. Long term, we'd rather you be able to take your work with you than trap you in a subscription.",
    ],
  },
  {
    id: "voice",
    question: "Is the voice tutor actually useful, or just a gimmick?",
    paragraphs: [
      "It depends how you learn. For some people, talking through a concept out loud and hearing it explained back is genuinely how things click — it's closer to office hours than to reading. For others, text is faster and they'll skip it. It's there as an option, not a requirement, and you can use Aroses fully without it. We'd rather it earn its place than oversell it.",
    ],
  },
  {
    id: "quick-answer",
    question: "What if I just want a quick answer, not a full lesson?",
    paragraphs: [
      "Then a chatbot is honestly the faster tool for that one moment, and we won't pretend otherwise. Aroses is built for the times you need something to *stick* — before an exam, across a whole semester, for material you'll be tested on. Quick one-off lookups aren't what it's optimized for.",
    ],
  },
];

/** Shorter, app-specific FAQs that complement the honest list. */
export const HELP_APP_FAQ_ITEMS: HonestFaqItem[] = [
  {
    id: "mentored-vs-tutor",
    question: "What's the difference between Mentored Learning and a Tutor Session?",
    paragraphs: [
      "Mentored Learning follows a structured lesson plan from a course you built — Rose explains chunk by chunk, checks your understanding, and advances when you're ready. A Tutor Session is open-ended help on any topic (exam prep, homework, concept review). Great for a quick deep dive; you can turn a session into a full course afterward.",
    ],
  },
  {
    id: "voice-vs-text",
    question: "Voice vs text — which should I use?",
    paragraphs: [
      "Voice is best for being taught and conversational back-and-forth. Text is best for dense reading and quiet study. Switch anytime — mentored mode supports both, and when you hit your monthly voice cap you automatically fall back to text without losing access to the app.",
    ],
  },
];
