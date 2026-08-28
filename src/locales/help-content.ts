export type HelpFaqItemContent = {
  id: string;
  question: string;
  paragraphs: string[];
  bullets?: string[];
};

const en = {
  navAriaLabel: "Help sections",
  onThisPage: "On this page",
  intro:
    "Aroses turns your course material into structured lessons, a voice tutor that knows your content, quizzes, and spaced-repetition review. This guide matches the app as it works today — with screenshots-style previews of the actual UI.",
  videoComingSoon: "Video coming soon",
  sections: [
    { id: "quick-start", label: "Quick start" },
    { id: "videos", label: "Video walkthroughs" },
    { id: "getting-started", label: "Getting started" },
    { id: "building", label: "Building a course" },
    { id: "mentored", label: "Mentored Learning" },
    { id: "free-explore", label: "Free Exploration" },
    { id: "quizzes", label: "Quizzes & practice" },
    { id: "review", label: "Spaced repetition" },
    { id: "tutor", label: "Tutor sessions" },
    { id: "explore", label: "Explore" },
    { id: "sharing", label: "Sharing" },
    { id: "progress", label: "Progress & profile" },
    { id: "faq", label: "Honest FAQ" },
  ],
  quickStart: {
    title: "Quick start (60 seconds)",
    steps: [
      "**Sign up** with email or Google and finish onboarding (goals, persona, username, birth date).",
      "**Upload material** — PDF, slides, notes, images, or audio/video — from your [workspace](/) or a course page.",
      "**Watch the build** — live progress as Aroses generates your outline and modules.",
      "**Pick how you learn:** [Mentored Learning](#mentored) (Rose tutors you by voice) or [Free Exploration](#free-explore) (read at your pace).",
      "**Practice & review** — quizzes, then [spaced-repetition cards](/dashboard/review) so material sticks.",
    ],
    loop: "The loop: Upload → Build → Learn → Practice → Review.",
    previewTitle: "Home workspace",
    previewCaption:
      "After login, / is your hub — create courses, resume studying, and see review due counts.",
  },
  videos: {
    title: "Video walkthroughs",
    intro:
      "Full screen recordings are on the way. Until they're live, use the step-by-step sections below — each includes UI previews of what you'll see on screen. When videos are ready, they'll appear here automatically.",
    items: [
      {
        id: "quick-start",
        title: "Quick start — upload to review in 5 minutes",
        description:
          "Sign up, upload a PDF, watch the build, open Mentored Learning, and try a quiz.",
        durationLabel: "~5 min",
      },
      {
        id: "build-course",
        title: "Building a course (grouping files & sections)",
        description:
          "Combine lecture stacks, set a study goal, manage sections, and make a course public.",
        durationLabel: "~8 min",
      },
      {
        id: "mentored",
        title: "Mentored Learning with Rose",
        description:
          "Voice vs text, Hold M vs Live mode, notes panel, and check questions.",
        durationLabel: "~10 min",
      },
      {
        id: "free-explore",
        title: "Free Exploration — read, highlight, ask Rose",
        description:
          "Highlights, study chat, voice dock navigation, and the practice room.",
        durationLabel: "~8 min",
      },
      {
        id: "review",
        title: "Spaced repetition review",
        description:
          "Review hub, Again/Hard/Good/Easy ratings, and focus cards from your notes.",
        durationLabel: "~6 min",
      },
      {
        id: "tutor-session",
        title: "Standalone tutor sessions",
        description:
          "Start a session, upload references, live notes, recap, and convert to a course.",
        durationLabel: "~7 min",
      },
    ],
  },
  gettingStarted: {
    title: "1. Getting started",
    signup: {
      heading: "Signing up & onboarding",
      intro: "Create an account with email or Google. Onboarding walks you through:",
      items: [
        "**Persona** — Student, Educator, Professional, or Self-learner",
        "**Goals** — multi-select reasons you're here",
        "**School** — students & educators only (optional name with suggestions)",
        "**Username** — checked for availability live",
        "**Date of birth** — must be 13+",
        "**How did you hear about us?**",
      ],
    },
    navigation: {
      heading: "Navigation",
      intro: "The top bar on every signed-in page:",
      previewTitle: "Primary navigation",
      previewCaption: "Review shows a badge when cards are due today.",
      items: [
        "**Home** — workspace with your courses, continue studying, streak, and review banner",
        "**Tutor** — start a standalone session or open past sessions",
        "**Explore** — community courses (sign-in required)",
        "**Review** — global spaced-repetition hub",
        "**Profile** — settings, theme, progress",
      ],
    },
  },
  building: {
    title: "2. Building a course",
    createHeading: "Two ways to create",
    createItems: [
      "**Public course** — structured course with sections; optionally list on Explore when you're ready ([create](/dashboard/courses/new?mode=public))",
      "**Self Study** — private; Rose drafts a plan from your goal, you confirm, then upload ([create](/dashboard/courses/new?mode=selfStudy))",
    ],
    uploadHeading: "Upload & formats",
    uploadBody:
      "PDF, Word, PowerPoint, plain text, Markdown, RTF, images, audio, and video. Limits: **20 files** per batch, **1 GB** combined; 100 MB PDFs, 50 MB other documents, 100 MB audio, 500 MB video, 20 MB images. Audio/video is transcribed (25 MB cap for transcription).",
    uploadPreviewTitle: "Lecture grouping on upload",
    uploadPreviewCaption:
      "Related files (notes + screenshots + transcript) can be combined into one lecture. Drag files onto a lecture card or use Combine into one.",
    buildFlowHeading: "Build flow",
    buildFlowSteps: [
      "Upload files (optional per-upload study goal + polish)",
      "**Build theater** — live outline and module progress for each job",
      "For audio/video: **review the transcript** before generation continues",
      "Open the course — edit lessons, images, append quiz questions",
    ],
    managingHeading: "Managing your course",
    managingItems: [
      "**Sections** — create, rename, reorder; drag materials within a section",
      "**Edit course** — opens study view in manage mode",
      "**Refine with Rose** — plain-language AI edits to structure or content",
      "**Lesson images** — auto Wikimedia images; replace, remove, or upload your own in edit mode",
      "Images embedded in PDFs/Word/slides are pulled into lessons automatically",
      "Failed uploads show a warning with **Restart**",
    ],
    visibilityHeading: "Public vs private",
    visibilityBody:
      "From your home grid, use **Make public** / **Make private** on any course card. Inside a course, use the toggle switch:",
    visibilityPreviewTitle: "Public Explore listing toggle",
    visibilityPreviewCaption:
      "Explore only shows your course title and description — not your raw files. Sign-in is required to browse Explore.",
    courseCardPreviewTitle: "Course card actions",
  },
  mentored: {
    title: "3. Mentored Learning",
    intro:
      "Rose walks you through your course chunk by chunk — explain, check question, then advance. Best when you want to be taught, not just read.",
    modePickerPreviewTitle: "Mode picker (when you open Learn)",
    onboardingHeading: "Per-course onboarding",
    onboardingItems: [
      "Goals Q&A + quick knowledge quiz",
      "**Personalized course** (reordered) vs **Original outline**",
      "**Voice-first** vs **Text-first**",
      "Or **Skip the tutor — let me just read** → Free Exploration",
    ],
    duringHeading: "During a lesson",
    duringItems: [
      "Rose explains each chunk, then checks understanding — question in the dialogue strip (text) or a popup you can minimize (voice)",
      "**Source panel** — your original material alongside tutoring",
      "**Notes panel** — auto-generate, slash / commands, rich formatting",
      "On-image lookups from Wikimedia when helpful",
      "**Welcome back** screen if you've been away 5+ minutes — Rose resumes where you stopped",
    ],
    voicePreviewTitle: "Voice input modes",
    voicePreviewCaption:
      "Switch between Hold M and Live in the composer. Adjust playback speed (0.5×–1.5×).",
  },
  freeExplore: {
    title: "4. Free Exploration",
    intro:
      "Read at your own pace with Rose available on demand. Switch modes anytime with the course mode toggle.",
    items: [
      "**Sidebar curriculum** — modules, lessons, progress; scroll position saved",
      "**Highlights** — select text in Pink, Yellow, Blue, Green, or Purple; capture quotes to notes",
      "**Personal quiz** — turn notes/highlights into focus cards; from the notes editor, select a passage or key term and tap **Add to focus questions**",
      "**Media panel** — synced transcript for uploaded audio/video",
      "**Ask Rose!** — text study chat about the current module",
      "**Voice dock** — hold M or Live; language & speed controls; Rose can navigate by voice (\"take me to the section on…\")",
      "**Refine with Rose** — edit course content from the study view (owners)",
      "**Practice progress** pull-tab — scores at a glance",
    ],
  },
  quizzes: {
    title: "5. Quizzes & practice",
    intro:
      "From any lecture, tap **Go to practice room** — then pick a tab:",
    previewTitle: "Practice room tabs",
    items: [
      "**Module quiz** — MCQ + free response, AI-graded; **Practice again** when done; can mark module complete",
      "**Focus quiz** — your personal note cards (always practices all saved cards). Add more from the notes editor with **Add to focus questions**.",
      "**Whole-course mixed quiz** — separate link in the sidebar (not a third practice tab)",
      "Owners can **generate** more module quiz questions",
    ],
  },
  review: {
    title: "6. Spaced repetition (Review)",
    intro:
      "Flashcards resurface right before you'd forget — module quiz misses and personal focus cards feed the same pipeline. Open [Review](/dashboard/review) from the nav or the home banner (dismissible until tomorrow).",
    previewTitle: "Rating buttons after you reveal an answer",
    previewCaption: "Keyboard: Space/Enter to reveal, 1–4 to rate.",
    items: [
      "**Review All** or pick specific courses/materials",
      "Scope: **Both**, **Module only**, or **Focus only**",
      "Settings: daily new-card limit, max reviews, daily goal, reset all SRS data",
      "Pause / exit mid-session — resume later from browser storage",
    ],
  },
  tutor: {
    title: "7. Standalone tutor sessions",
    intro:
      "Open-ended help — not tied to a course. Start from [Tutor](/tutor-session) or home. Past sessions live at [/sessions](/sessions).",
    previewTitle: "Session modes at start",
    items: [
      "Optional topic; up to **20 files**, 200 MB combined (PDF, Word, slides, images, text — not audio/video)",
      "Paste screenshots from clipboard; add files mid-session",
      "**Skip and just start talking** — no setup required",
      "Live Notion-style notes (synthesized, not raw transcript). Select a passage and tap **Add to focus questions** to quiz yourself later.",
      "Voice: Hold M or Live; text input anytime",
    ],
    inactivityHeading: "Inactivity timeline",
    inactivityItems: [
      "~**5 min** silence → Rose sends a gentle check-in",
      "~**15 min** → final check-in, session **paused**",
      "~**60 min** total silence → session auto-ends",
    ],
    afterHeading: "After the session",
    afterItems: [
      "Recap: edit, copy, download .md, print/PDF, share public link, regenerate, delete",
      "**Build a structured course from this session**",
    ],
  },
  explore: {
    title: "8. Explore (community courses)",
    items: [
      "[Explore](/explore) requires sign-in — browse filters: All, Featured, Popular, Rated",
      "Preview outline before starting; full learn/study/quiz/review experience",
      "Your progress is tracked per account",
      "Creators: toggle **Make public** — only title + description appear on Explore until someone opens the course",
    ],
  },
  sharing: {
    title: "9. Sharing",
    tableWhat: "What you share",
    tableOthers: "What others see",
    rows: [
      {
        what: "Explore listing (public course)",
        others: "Title + description on Explore; sign in to study",
      },
      {
        what: "Share study link (from course page)",
        others: "Read-only lessons + quizzes; sign-up CTA for anonymous viewers",
      },
      {
        what: "Session recap link",
        others: "Recap markdown only — no transcript or uploads",
      },
    ],
  },
  progress: {
    title: "10. Progress & profile",
    items: [
      "[Profile](/dashboard/profile) — General (name, username, avatar, theme, study focus), Account, Progress tab",
      "Progress rings — modules completed & quiz accuracy per course",
      "Activity heatmap — last two weeks of study",
      "**Resume everywhere** — module, lesson, scroll, mode, mentored chunk, even a paused tutor session",
      "Home streak grid — 7-day activity",
    ],
  },
  previews: {
    whatYoullSee: "What you'll see",
    workspace: {
      label: "Your workspace",
      heading: "Start something new",
      createCourse: "+ Create course",
      startTutor: "Start a tutor session",
      cardsDue: "12 cards due today",
      reviewLink: "→ Review",
    },
    courseCard: {
      onExplore: "On Explore",
      notOnExplore: "Not on Explore",
      openCourse: "Open course →",
      makePrivate: "Make private",
      makePublic: "Make public",
    },
    visibility: {
      heading: "Make this course public",
      listedOnExplore: "Listed on Explore — anyone signed in can discover it.",
      privateOnly: "Private — only you can see it from your dashboard.",
      public: "Public",
      private: "Private",
    },
    upload: {
      summary: "3 files → 2 lectures. Drag files together to combine related material.",
      lectureCombined: "2 files combined",
      lectureLabel: "Lecture {n}",
    },
    modeToggle: {
      label: "Course mode",
    },
    voiceModes: {
      holdM: "Hold M",
      holdMHint: "Press & hold M or the mic",
      live: "Live",
      liveHint: "Auto-listens — just start speaking",
    },
    practiceRoom: {
      moduleQuiz: "Module quiz",
      focusQuiz: "Focus quiz",
      hint: "From a lecture page, tap **Go to practice room** — then switch tabs here. Whole-course mix lives in the sidebar separately.",
    },
    nav: {
      tutor: "Tutor ▾",
      reviewBadge: "Review 12",
    },
    tutorModes: [
      "Exam prep",
      "Homework help",
      "Concept review",
      "Quiz me",
      "Just exploring",
    ],
  },
  faq: {
    title: "Honest FAQ",
    subtitle:
      "Straight answers to the questions skeptical students actually ask. No hype.",
    appTitle: "Quick app questions",
    appSubtitle:
      "How features in Aroses fit together — see the sections above for walkthroughs.",
    pricingParagraph:
      "You're not paying for access to AI — that's commoditized. You're paying for the parts that turn AI into a study routine you'll actually follow: course-structured lessons, persistent spaced repetition, progress tracking, and not having to engineer prompts. **Free** includes {freeHighlight} plus unlimited text tutoring, quizzes, SRS, **1 course**, and 1 lecture recording / month. **Student** is ${studentPrice}/month ({studentVoiceHours} hours of voice/month, up to 2 courses, 5 lecture recordings / month). **Advanced** is ${advancedPrice}/month ({advancedVoiceHours} hours of voice/month, up to 5 courses, 10 lecture recordings / month). **Premium** is ${premiumPrice}/month ({premiumVoiceHours} hours of voice/month, unlimited courses, 20 lecture recordings / month). Voice caps switch you to text — never a hard block mid-study. Optional voice top-ups are planned (~$8/hour). If you have the discipline to rebuild all of this yourself with free tools every session, you may not need us. Most people don't, and that's who Aroses is for.",
    honestItems: [
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
        paragraphs: [],
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
    ] as HelpFaqItemContent[],
    appItems: [
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
        paragraphs: [],
        paragraphWithBilling:
          "Voice is best for being taught and conversational back-and-forth. Text is best for dense reading and quiet study. Switch anytime — mentored mode supports both, and when you hit your monthly voice cap you automatically fall back to text without losing access to the app.",
        paragraphNoBilling:
          "Voice is best for being taught and conversational back-and-forth. Text is best for dense reading and quiet study. Switch anytime — mentored mode supports both. If you run out of voice time for the month, the app switches you to text automatically so you can keep studying.",
      },
    ] as (HelpFaqItemContent & {
      paragraphWithBilling?: string;
      paragraphNoBilling?: string;
    })[],
  },
};

const ko: typeof en = {
  navAriaLabel: "도움말 섹션",
  onThisPage: "이 페이지에서",
  intro:
    "Aroses는 강의 자료를 구조화된 레슨, 내용을 아는 음성 튜터, 퀴즈, 간격 반복 복습으로 바꿔 줘요. 이 가이드는 지금 앱이 동작하는 방식과 맞춰져 있으며, 실제 UI를 보여 주는 미리보기가 포함돼 있어요.",
  videoComingSoon: "영상 준비 중",
  sections: [
    { id: "quick-start", label: "빠른 시작" },
    { id: "videos", label: "영상 워크스루" },
    { id: "getting-started", label: "시작하기" },
    { id: "building", label: "코스 만들기" },
    { id: "mentored", label: "멘토 학습" },
    { id: "free-explore", label: "자유 탐색" },
    { id: "quizzes", label: "퀴즈 및 연습" },
    { id: "review", label: "간격 반복" },
    { id: "tutor", label: "튜터 세션" },
    { id: "explore", label: "탐색" },
    { id: "sharing", label: "공유" },
    { id: "progress", label: "진행 상황 및 프로필" },
    { id: "faq", label: "솔직한 FAQ" },
  ],
  quickStart: {
    title: "빠른 시작 (60초)",
    steps: [
      "이메일 또는 Google로 **가입**하고 온보딩을 마치세요 (목표, 페르소나, 사용자 이름, 생년월일).",
      "[워크스페이스](/) 또는 코스 페이지에서 PDF, 슬라이드, 노트, 이미지, 오디오/비디오 등 **자료를 업로드**하세요.",
      "Aroses가 목차와 모듈을 생성하는 동안 **빌드 진행 상황**을 실시간으로 확인하세요.",
      "**학습 방식 선택:** [멘토 학습](#mentored) (Rose가 음성으로 가르침) 또는 [자유 탐색](#free-explore) (내 속도로 읽기).",
      "퀴즈로 **연습하고 복습** — [간격 반복 카드](/dashboard/review)로 내용이 오래 기억되게 하세요.",
    ],
    loop: "반복 루프: 업로드 → 빌드 → 학습 → 연습 → 복습.",
    previewTitle: "홈 워크스페이스",
    previewCaption:
      "로그인 후 / 가 허브예요 — 코스를 만들고, 학습을 이어가고, 오늘 복습할 카드 수를 확인할 수 있어요.",
  },
  videos: {
    title: "영상 워크스루",
    intro:
      "전체 화면 녹화 영상을 준비 중이에요. 공개되기 전까지는 아래 단계별 섹션을 이용하세요 — 각 섹션에 화면에서 보게 될 UI 미리보기가 포함돼 있어요. 영상이 준비되면 여기에 자동으로 표시될 거예요.",
    items: [
      {
        id: "quick-start",
        title: "빠른 시작 — 5분 만에 업로드부터 복습까지",
        description:
          "가입, PDF 업로드, 빌드 확인, 멘토 학습 열기, 퀴즈 체험.",
        durationLabel: "약 5분",
      },
      {
        id: "build-course",
        title: "코스 만들기 (파일 묶기 및 섹션)",
        description:
          "강의 스택 묶기, 학습 목표 설정, 섹션 관리, 코스 공개하기.",
        durationLabel: "약 8분",
      },
      {
        id: "mentored",
        title: "Rose와 멘토 학습",
        description:
          "음성 vs 텍스트, Hold M vs Live 모드, 노트 패널, 확인 질문.",
        durationLabel: "약 10분",
      },
      {
        id: "free-explore",
        title: "자유 탐색 — 읽기, 하이라이트, Rose에게 질문",
        description:
          "하이라이트, 학습 채팅, 음성 독 내비게이션, 연습실.",
        durationLabel: "약 8분",
      },
      {
        id: "review",
        title: "간격 반복 복습",
        description:
          "복습 허브, Again/Hard/Good/Easy 평가, 노트에서 만든 포커스 카드.",
        durationLabel: "약 6분",
      },
      {
        id: "tutor-session",
        title: "독립 튜터 세션",
        description:
          "세션 시작, 참고 자료 업로드, 실시간 노트, 요약, 코스로 변환.",
        durationLabel: "약 7분",
      },
    ],
  },
  gettingStarted: {
    title: "1. 시작하기",
    signup: {
      heading: "가입 및 온보딩",
      intro: "이메일 또는 Google로 계정을 만드세요. 온보딩에서 다음을 진행해요:",
      items: [
        "**페르소나** — 학생, 교육자, 직장인, 독학자",
        "**목표** — 여기 온 이유를 여러 개 선택",
        "**학교** — 학생·교육자만 (선택, 추천 이름 제공)",
        "**사용자 이름** — 실시간 중복 확인",
        "**생년월일** — 만 13세 이상",
        "**어떻게 알게 되셨나요?**",
      ],
    },
    navigation: {
      heading: "내비게이션",
      intro: "로그인한 모든 페이지 상단 바:",
      previewTitle: "주요 내비게이션",
      previewCaption: "오늘 복습할 카드가 있으면 복습에 배지가 표시돼요.",
      items: [
        "**홈** — 내 코스, 학습 이어하기, 연속 학습, 복습 배너가 있는 워크스페이스",
        "**튜터** — 독립 세션 시작 또는 이전 세션 열기",
        "**탐색** — 커뮤니티 코스 (로그인 필요)",
        "**복습** — 전역 간격 반복 허브",
        "**프로필** — 설정, 테마, 진행 상황",
      ],
    },
  },
  building: {
    title: "2. 코스 만들기",
    createHeading: "만드는 두 가지 방법",
    createItems: [
      "**공개 코스** — 섹션이 있는 구조화된 코스; 준비되면 Explore에 등록 가능 ([만들기](/dashboard/courses/new?mode=public))",
      "**자기 학습** — 비공개; Rose가 목표로 계획을 초안 작성, 확인 후 업로드 ([만들기](/dashboard/courses/new?mode=selfStudy))",
    ],
    uploadHeading: "업로드 및 형식",
    uploadBody:
      "PDF, Word, PowerPoint, 일반 텍스트, Markdown, RTF, 이미지, 오디오, 비디오. 제한: 배치당 **20개 파일**, 합계 **1GB**; PDF 100MB, 기타 문서 50MB, 오디오 100MB, 비디오 500MB, 이미지 20MB. 오디오/비디오는 전사됩니다 (전사 25MB 한도).",
    uploadPreviewTitle: "업로드 시 강의 묶기",
    uploadPreviewCaption:
      "관련 파일(노트 + 스크린샷 + 전사)을 하나의 강의로 묶을 수 있어요. 강의 카드에 파일을 끌어다 놓거나 '하나로 묶기'를 사용하세요.",
    buildFlowHeading: "빌드 흐름",
    buildFlowSteps: [
      "파일 업로드 (업로드마다 선택: 학습 목표 + 다듬기)",
      "**빌드 시어터** — 각 작업의 실시간 목차 및 모듈 진행",
      "오디오/비디오: 생성이 계속되기 전 **전사 내용 검토**",
      "코스 열기 — 레슨·이미지 편집, 퀴즈 문제 추가",
    ],
    managingHeading: "코스 관리",
    managingItems: [
      "**섹션** — 만들기, 이름 변경, 순서 변경; 섹션 내 자료 끌어서 이동",
      "**코스 편집** — 관리 모드로 학습 보기 열기",
      "**Rose로 다듬기** — 구조나 내용을 자연어로 AI 편집",
      "**레슨 이미지** — Wikimedia 자동 이미지; 편집 모드에서 교체·삭제·직접 업로드",
      "PDF/Word/슬라이드에 포함된 이미지는 레슨에 자동으로 가져와져요",
      "업로드 실패 시 **다시 시작**이 있는 경고 표시",
    ],
    visibilityHeading: "공개 vs 비공개",
    visibilityBody:
      "홈 그리드에서 코스 카드의 **공개하기** / **비공개로**를 사용하세요. 코스 안에서는 토글 스위치를 사용해요:",
    visibilityPreviewTitle: "Explore 공개 등록 토글",
    visibilityPreviewCaption:
      "Explore에는 코스 제목과 설명만 표시돼요 — 원본 파일은 아니에요. Explore 탐색에는 로그인이 필요해요.",
    courseCardPreviewTitle: "코스 카드 작업",
  },
  mentored: {
    title: "3. 멘토 학습",
    intro:
      "Rose가 코스를 조각별로 안내해요 — 설명, 확인 질문, 다음으로 진행. 읽기만이 아니라 가르침을 받고 싶을 때 적합해요.",
    modePickerPreviewTitle: "학습 열 때 모드 선택",
    onboardingHeading: "코스별 온보딩",
    onboardingItems: [
      "목표 Q&A + 빠른 지식 퀴즈",
      "**맞춤 코스** (재정렬) vs **원본 목차**",
      "**음성 우선** vs **텍스트 우선**",
      "또는 **튜터 건너뛰기 — 그냥 읽을게요** → 자유 탐색",
    ],
    duringHeading: "레슨 중",
    duringItems: [
      "Rose가 각 조각을 설명한 뒤 이해를 확인해요 — 대화창 질문(텍스트) 또는 최소화 가능한 팝업(음성)",
      "**원본 패널** — 튜터링 옆에 원본 자료",
      "**노트 패널** — 자동 생성, / 슬래시 명령, 서식",
      "도움이 될 때 Wikimedia 이미지 조회",
      "5분 이상 자리를 비우면 **다시 오신 것을 환영합니다** 화면 — Rose가 멈춘 곳부터 재개",
    ],
    voicePreviewTitle: "음성 입력 모드",
    voicePreviewCaption:
      "작성창에서 Hold M과 Live를 전환하세요. 재생 속도 조절 (0.5×–1.5×).",
  },
  freeExplore: {
    title: "4. 자유 탐색",
    intro:
      "Rose를 필요할 때 호출하며 내 속도로 읽어요. 코스 모드 토글로 언제든 모드를 바꿀 수 있어요.",
    items: [
      "**사이드바 커리큘럼** — 모듈, 레슨, 진행; 스크롤 위치 저장",
      "**하이라이트** — 분홍, 노랑, 파랑, 초록, 보라로 텍스트 선택; 인용을 노트에 저장",
      "**개인 퀴즈** — 노트/하이라이트를 포커스 카드로; 노트 편집기에서 문장이나 핵심 용어를 선택한 뒤 **포커스 질문에 추가**",
      "**미디어 패널** — 업로드한 오디오/비디오 동기화 전사",
      "**Rose에게 질문!** — 현재 모듈에 대한 텍스트 학습 채팅",
      "**음성 독** — M 길게 누르기 또는 Live; 언어·속도 조절; Rose가 음성으로 이동 가능 (\"…에 관한 섹션으로\")",
      "**Rose로 다듬기** — 학습 보기에서 코스 내용 편집 (소유자)",
      "**연습 진행** 탭 — 한눈에 점수",
    ],
  },
  quizzes: {
    title: "5. 퀴즈 및 연습",
    intro: "강의에서 **연습실로 이동**을 누른 뒤 탭을 선택하세요:",
    previewTitle: "연습실 탭",
    items: [
      "**모듈 퀴즈** — 객관식 + 서술형, AI 채점; 끝나면 **다시 연습**; 모듈 완료 표시 가능",
      "**포커스 퀴즈** — 개인 노트 카드 (저장된 카드 전부 연습). 노트 편집기에서 **포커스 질문에 추가**로 더 만들 수 있어요.",
      "**전체 코스 혼합 퀴즈** — 사이드바 별도 링크 (세 번째 연습 탭 아님)",
      "소유자는 모듈 퀴즈 문제를 더 **생성**할 수 있어요",
    ],
  },
  review: {
    title: "6. 간격 반복 (복습)",
    intro:
      "잊기 직전에 플래시카드가 다시 나타나요 — 모듈 퀴즈 오답과 개인 포커스 카드가 같은 파이프라인으로 이어져요. 내비 또는 홈 배너(내일까지 닫기 가능)에서 [복습](/dashboard/review)을 여세요.",
    previewTitle: "답을 공개한 뒤 평가 버튼",
    previewCaption: "키보드: Space/Enter로 공개, 1–4로 평가.",
    items: [
      "**전체 복습** 또는 특정 코스/자료 선택",
      "범위: **둘 다**, **모듈만**, **포커스만**",
      "설정: 일일 새 카드 한도, 최대 복습, 일일 목표, SRS 데이터 전체 초기화",
      "세션 중 일시정지/종료 — 브라우저 저장으로 나중에 재개",
    ],
  },
  tutor: {
    title: "7. 독립 튜터 세션",
    intro:
      "코스와 무관한 자유로운 도움. [튜터](/tutor-session) 또는 홈에서 시작. 이전 세션은 [/sessions](/sessions)에 있어요.",
    previewTitle: "시작 시 세션 모드",
    items: [
      "선택 주제; 최대 **20개 파일**, 합계 200MB (PDF, Word, 슬라이드, 이미지, 텍스트 — 오디오/비디오 제외)",
      "클립보드에서 스크린샷 붙여넣기; 세션 중 파일 추가",
      "**건너뛰고 대화 시작** — 설정 없이 가능",
      "Notion 스타일 실시간 노트 (원문 전사 아님). 구간을 선택한 뒤 **포커스 질문에 추가**하면 나중에 퀴즈로 풀 수 있어요.",
      "음성: Hold M 또는 Live; 언제든 텍스트 입력",
    ],
    inactivityHeading: "비활성 타임라인",
    inactivityItems: [
      "약 **5분** 침묵 → Rose가 부드럽게 확인",
      "약 **15분** → 마지막 확인, 세션 **일시정지**",
      "약 **60분** 총 침묵 → 세션 자동 종료",
    ],
    afterHeading: "세션 후",
    afterItems: [
      "요약: 편집, 복사, .md 다운로드, 인쇄/PDF, 공개 링크 공유, 재생성, 삭제",
      "**이 세션에서 구조화된 코스 만들기**",
    ],
  },
  explore: {
    title: "8. 탐색 (커뮤니티 코스)",
    items: [
      "[탐색](/explore)은 로그인 필요 — 필터: 전체, 추천, 인기, 평점",
      "시작 전 목차 미리보기; 학습/연습/퀴즈/복습 전체 경험",
      "계정별로 진행 상황 추적",
      "제작자: **공개하기** 토글 — 누군가 코스를 열기 전까지 Explore에는 제목+설명만 표시",
    ],
  },
  sharing: {
    title: "9. 공유",
    tableWhat: "공유하는 것",
    tableOthers: "다른 사람이 보는 것",
    rows: [
      {
        what: "Explore 등록 (공개 코스)",
        others: "Explore에 제목+설명; 학습하려면 로그인",
      },
      {
        what: "학습 링크 공유 (코스 페이지에서)",
        others: "읽기 전용 레슨+퀴즈; 익명 방문자에게 가입 유도",
      },
      {
        what: "세션 요약 링크",
        others: "요약 마크다운만 — 전사나 업로드 없음",
      },
    ],
  },
  progress: {
    title: "10. 진행 상황 및 프로필",
    items: [
      "[프로필](/dashboard/profile) — 일반 (이름, 사용자 이름, 아바타, 테마, 학습 집중), 계정, 진행 탭",
      "진행 링 — 코스별 완료 모듈 및 퀴즈 정확도",
      "활동 히트맵 — 최근 2주 학습",
      "**어디서든 이어하기** — 모듈, 레슨, 스크롤, 모드, 멘토 조각, 일시정지된 튜터 세션까지",
      "홈 연속 학습 그리드 — 7일 활동",
    ],
  },
  previews: {
    whatYoullSee: "화면에서 보게 될 것",
    workspace: {
      label: "내 워크스페이스",
      heading: "새로 시작하기",
      createCourse: "+ 코스 만들기",
      startTutor: "튜터 세션 시작",
      cardsDue: "오늘 복습할 카드 12장",
      reviewLink: "→ 복습",
    },
    courseCard: {
      onExplore: "Explore에 등록됨",
      notOnExplore: "Explore 미등록",
      openCourse: "코스 열기 →",
      makePrivate: "비공개로",
      makePublic: "공개하기",
    },
    visibility: {
      heading: "이 코스를 공개하기",
      listedOnExplore: "Explore에 등록됨 — 로그인한 사용자가 찾을 수 있어요.",
      privateOnly: "비공개 — 대시보드에서만 볼 수 있어요.",
      public: "공개",
      private: "비공개",
    },
    upload: {
      summary: "파일 3개 → 강의 2개. 관련 자료를 묶으려면 파일을 함께 끌어다 놓으세요.",
      lectureCombined: "파일 2개 묶음",
      lectureLabel: "강의 {n}",
    },
    modeToggle: {
      label: "코스 모드",
    },
    voiceModes: {
      holdM: "Hold M",
      holdMHint: "M 키 또는 마이크를 길게 누르기",
      live: "Live",
      liveHint: "자동 수신 — 말하기만 하면 돼요",
    },
    practiceRoom: {
      moduleQuiz: "모듈 퀴즈",
      focusQuiz: "포커스 퀴즈",
      hint: "강의 페이지에서 **연습실로 이동**을 누른 뒤 여기서 탭을 전환하세요. 전체 코스 혼합은 사이드바에 별도로 있어요.",
    },
    nav: {
      tutor: "튜터 ▾",
      reviewBadge: "복습 12",
    },
    tutorModes: [
      "시험 대비",
      "숙제 도움",
      "개념 복습",
      "퀴즈 내기",
      "그냥 탐색",
    ],
  },
  faq: {
    title: "솔직한 FAQ",
    subtitle:
      "회의적인 학생들이 실제로 묻는 질문에 솔직하게 답해요. 과장 없이.",
    appTitle: "앱 빠른 질문",
    appSubtitle:
      "Aroses 기능이 어떻게 맞물리는지 — 위 섹션에서 자세한 안내를 확인하세요.",
    pricingParagraph:
      "AI 접근권에 돈을 내는 게 아니에요 — 그건 이미 흔해졌죠. 돈을 내는 이유는 AI를 실제로 지킬 학습 루틴으로 바꿔 주는 부분이에요: 코스 구조 레슨, 지속적인 간격 반복, 진행 추적, 매번 프롬프트를 설계하지 않아도 되는 것. **무료**에는 {freeHighlight}와 무제한 텍스트 튜터링, 퀴즈, SRS, **코스 1개**, 월 강의 녹음 1회가 포함돼요. **Student**는 월 ${studentPrice} ({studentVoiceHours}시간 음성/월, 코스 최대 2개, 녹음 5회). **Advanced**는 월 ${advancedPrice} ({advancedVoiceHours}시간 음성/월, 코스 최대 5개, 녹음 10회). **Premium**은 월 ${premiumPrice} ({premiumVoiceHours}시간 음성/월, 무제한 코스, 녹음 20회). 음성 한도에 도달하면 텍스트로 전환돼요 — 학습 중 갑자기 막히지 않아요. 선택적 음성 추가 구매도 계획 중이에요 (약 $8/시간). 매 세션마다 무료 도구로 이걸 전부 직접 만들 자신이 있다면 우리가 필요 없을 수도 있어요. 대부분은 그렇지 않고, 그게 Aroses가 있는 이유예요.",
    honestItems: [
      {
        id: "vs-chatgpt",
        question: "Aroses와 ChatGPT나 Claude를 쓰는 것의 차이는?",
        paragraphs: [
          "일반 챗봇은 답을 줘요. Aroses는 실제로 기억하게 만드는 데 초점을 맞춰요. 기본 모델은 비슷할 수 있어요 — 차이는 그 주변 시스템이에요: 레슨은 내 강의 자료에서 만들어지고, 틀린 답은 시험 전에 다시 나오는 간격 반복 플래시카드가 되며, 공부한 내용이 한곳에서 추적돼요. 챗봇은 탭을 닫는 순간 나를 잊어요.",
          "요약: **빠른 답이 필요하면 ChatGPT; 내용이 오래 남아야 하면 Aroses.**",
        ],
      },
      {
        id: "upload-to-chatgpt",
        question: "강의 노트를 ChatGPT에 올려서 가르쳐 달라고 하면 되지 않나요?",
        paragraphs: [
          "솔직히 — 네, 한 세션 정도는 꽤 잘 해줘요. 그걸 부정하지 않을게요. 차이는 *그 세션 이후*에 생겨요:",
        ],
        bullets: [
          "ChatGPT는 채팅을 닫으면 모든 걸 잊어요. Aroses는 어려웠던 부분을 기억하고 일정에 맞춰 다시 가져와요.",
          "ChatGPT를 진짜 튜터처럼 (조각별 설명, 퀴즈, 답 대신 회상) 만들려면 *매번* *매 코스마다* 프롬프트를 잘 써야 해요. Aroses에는 그게 내장돼 있고 일관되게 적용돼요.",
          "챗봇에서 가장 쉬운 건 답을 물어보고 베끼는 거예요. 공부하는 것 같지만 아니에요. Aroses 기본 설정은 회상을 하게 만들어요.",
          "돈 내는 이유는 AI가 \"못 하는\" 기능이 아니라, 그냥 작동하는 구조화된 시스템이에요.",
        ],
      },
      {
        id: "accuracy",
        question: "레슨이 정확한지 어떻게 알죠? AI가 지어내지 않나요?",
        paragraphs: [
          "AI는 틀릴 수 있어요 — 이 분야 모든 도구, 우리 포함,에 해당해요. 두 가지가 위험을 줄여요: 레슨은 일반 인터넷 지식이 아니라 *내가* 올린 자료에서 생성돼 교수님이 가르친 내용에 더 가깝고, 형식이 수동적 신뢰보다 이해 확인을 유도해요. 그래도 Aroses는 학습 보조로 보세요, 절대 진리가 아니에요. 교과서나 강의와 다르면 강의가 이겨요. 과장보다 솔직히 말하는 편이에요.",
        ],
      },
      {
        id: "why-pay",
        question: "ChatGPT와 Claude 무료 버전이 있는데 왜 돈을 내야 하나요?",
        paragraphs: [],
      },
      {
        id: "vs-anki",
        question: "Anki나 Quizlet에 단계만 더한 거 아닌가요?",
        paragraphs: [
          "겹치는 부분은 있어요 — 플래시카드는 Anki와 같은 간격 반복 원리를 씁니다. Anki는 무료이고 훌륭해요. 차이는 카드를 직접 만들지 않는다는 거예요; 코스에서, 더 중요하게는 학습 중 틀린 질문에서 생성돼요. 덱을 만드는 대신 공부하면, 복습 시스템이 약한 부분 주변을 스스로 채워요. Anki 덱을 손으로 만드는 걸 좋아한다면 필요 없을 수 있어요. 잘 못 따라갔다면 그게 우리가 메우는 간극이에요.",
        ],
      },
      {
        id: "grades",
        question: "성적이 실제로 오를까요?",
        paragraphs: [
          "성적을 약속할 수는 없어요 — 그렇게 말하는 사람은 뭔가 팔려는 거예요. Aroses가 기반으로 하는 방법(능동 회상, 간격 반복)은 연구에서 가장 잘 뒷받침되는 학습 기법 중 하나예요. *내* 성적이 오르는지는 꾸준히 쓰는지에 달려 있어요. 입증 못 할 주장보다 기대를 솔직히 말하는 편이에요.",
        ],
      },
      {
        id: "cheating",
        question: "AI로 공부하는 건 기본적으로 부정행위 아닌가요?",
        paragraphs: [
          "아니요 — 선이 있고, Aroses는 올바른 쪽에 있어요. AI에게 에세이를 쓰게 하고 제출하는 건 부정행위예요. 개념 설명, 퀴즈, 이해할 때까지 반복은 그냥 튜터링이에요 — 학생들이 오래전부터 사람에게 돈 내온 것과 같아요. Aroses는 *내가* 회상하도록 설계됐지, 대신 일하게 하려는 게 아니에요. (다만 학교 AI 정책은 각자 다르니 따르세요.)",
        ],
      },
      {
        id: "privacy",
        question: "강의 자료는 어떻게 되나요? 내 데이터는 안전한가요?",
        paragraphs: [
          "업로드와 생성된 코스는 학습을 이어가려고 계정에 저장돼요 — Explore에 코스를 명시적으로 등록하지 않는 한 공개되지 않아요 (제목+설명만; 원본 파일은 비공개). 레슨 생성과 튜터 답변을 위해 AI 제공업체(예: Anthropic)에 내용을 보내지만, 자료로 모델을 학습시키지는 않아요. 수집·보관·삭제·제3자 전체는 [개인정보 처리방침](/legal/privacy)을 읽어 보세요. 프로필 설정에서 계정과 데이터를 삭제할 수 있어요; 불명확하면 이메일 주시면 솔직히 답할게요.",
        ],
      },
      {
        id: "niche-courses",
        question: "코스가 아주 틈새거나 PDF가 지저분하면요?",
        paragraphs: [
          "Aroses는 비교적 깨끗한 텍스트 기반 자료에 가장 잘 맞아요. 아주 틈새 과목도 내 파일에서 레슨을 만들기 때문에 온라인에서 흔한 주제가 아니어도 될 수 있어요. 솔직한 주의: 스캔 PDF나 형식이 엉망이면 읽을 수 있는 만큼만 작업하므로 결과가 약할 수 있어요. 코스가 거칠게 나오면 보통 입력 품질 문제고, 더 깨끗한 원본이 대부분 해결해요.",
        ],
      },
      {
        id: "cancel",
        question: "결제를 멈추거나 앱이 문을 닫으면 코스와 진행은 어떻게 되나요?",
        paragraphs: [
          "유료 요금제를 취소해도 **무료** 등급 계정은 유지돼요 — 코스, 노트, 퀴즈 기록, SRS 카드는 삭제하지 않는 한 남아요. 음성은 무료 월 한도로 줄고, 나머지(텍스트 튜터링, 빌드, 퀴즈, 복습)는 계속 쓸 수 있어요. 아직 \"전체 코스를 PDF로 내보내기\" 원클릭은 없어요; 레슨 텍스트 복사, 튜터 세션 요약 다운로드(해당 기능 있는 경우)는 가능해요. 더 나은 이식성을 만들고 있어요 — 내 자료가 구독에 갇히면 안 돼요. 장기적으로는 가두기보다 가져갈 수 있게 하는 편이에요.",
        ],
      },
      {
        id: "voice",
        question: "음성 튜터는 진짜 유용한가요, 그냥 gimmick인가요?",
        paragraphs: [
          "학습 방식에 달려요. 어떤 사람에게는 소리 내어 설명하고 들으며 이해하는 게 진짜로 맞고, 읽기보다 office hours에 가까워요. 다른 사람은 텍스트가 더 빠르고 건너뛸 거예요. 필수가 아니라 선택이에요, 음성 없이도 Aroses를 충분히 쓸 수 있어요. 과장보다 쓸 만한 가치를 증명하는 편이에요.",
        ],
      },
      {
        id: "quick-answer",
        question: "전체 레슨 말고 빠른 답만 원하면요?",
        paragraphs: [
          "그 한 순간에는 솔직히 챗봇이 더 빨라요, 그걸 숨기지 않을게요. Aroses는 *오래* 남아야 할 때를 위해 만들어졌어요 — 시험 전, 한 학기 내내, 시험 볼 내용. 일회성 조회에는 최적화되지 않았어요.",
        ],
      },
    ] as HelpFaqItemContent[],
    appItems: [
      {
        id: "mentored-vs-tutor",
        question: "멘토 학습과 튜터 세션의 차이는?",
        paragraphs: [
          "멘토 학습은 만든 코스의 구조화된 레슨 계획을 따라가요 — Rose가 조각별로 설명하고 이해를 확인한 뒤 준비되면 진행해요. 튜터 세션은 어떤 주제든(시험 대비, 숙제, 개념 복습) 자유로운 도움이에요. 빠른 심화에 좋고, 세션 후 전체 코스로 만들 수 있어요.",
        ],
      },
      {
        id: "voice-vs-text",
        question: "음성 vs 텍스트 — 뭘 써야 하나요?",
        paragraphs: [],
        paragraphWithBilling:
          "가르침을 받고 대화형으로 주고받을 때는 음성이 좋아요. 빽빽한 읽기와 조용한 공부에는 텍스트가 좋아요. 언제든 전환 가능 — 멘토 모드는 둘 다 지원하고, 월 음성 한도에 도달하면 앱 접근 없이 텍스트로 자동 전환돼요.",
        paragraphNoBilling:
          "가르침을 받고 대화형으로 주고받을 때는 음성이 좋아요. 빽빽한 읽기와 조용한 공부에는 텍스트가 좋아요. 언제든 전환 가능 — 멘토 모드는 둘 다 지원해요. 월 음성 시간이 다 되면 앱이 텍스트로 자동 전환해 학습을 이어갈 수 있어요.",
      },
    ] as (HelpFaqItemContent & {
      paragraphWithBilling?: string;
      paragraphNoBilling?: string;
    })[],
  },
};

export const helpContent = { en, ko };

export type HelpContent = typeof en;
