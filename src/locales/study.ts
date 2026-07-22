const en = {
  // Sidebar / course chrome
  lessons: "Lessons",
  yourCourse: "Your course",
  course: "Course",
  showMore: "Show more",
  showLess: "Show less",
  thisUpload: "This upload",
  modulesProgress: "{completed}/{total} modules",
  wholeCourseMixedQuiz: "Whole-course mixed quiz",
  allMaterials: "All materials",
  curriculum: "Curriculum",
  section: "Section",
  other: "Other",
  viewing: "viewing",
  moduleTitle: "Module title",
  save: "Save",
  cancel: "Cancel",
  rename: "Rename",
  delete: "Delete",
  sourceFile: "Source file:",
  noModules: "No modules in this course.",
  hideModules: "Hide modules",
  showModules: "Show modules",

  // Refine-applied flash banner
  updatingStudyContent: "Updating study content",
  mergingEdits: "Merging your edits into this page…",

  // Mode toggle
  modeToggleHint:
    "Mentored Learning opens in a focused tutoring view; Free Exploration is the reading mode you're in now.",

  // Module header / lesson navigation
  moduleLabel: "Module {id}",
  jumpToLesson: "Jump to lesson",
  jumpToLessonPlaceholder: "Jump to lesson…",

  // Practice & review card (lessons mode)
  practiceAndReview: "Practice & review",
  practiceAndReviewBody:
    "Head to the practice room to run the module quiz or your focus cards — switch between them with the tabs there.",
  moduleCompleteBanner:
    "Module complete — open the practice room to run questions again anytime.",
  goToPracticeRoom: "Go to practice room",

  // Practice page header / tabs
  practiceIntroBeforeModule: "Switch with the tabs below — ",
  practiceIntroBetween: " is the shared bank; ",
  practiceIntroAfter: " is your private cards from notes.",
  practiceType: "Practice type",
  moduleQuiz: "Module quiz",
  focusQuiz: "Focus quiz",

  // Module bank review
  moduleBankReview: "Module bank review",
  moduleBankReviewDesc:
    "Shared questions for this module (same pool as the quiz below). Focus cards stay under the Focus quiz tab.",
  noBankQuestions: "No module bank questions for this module yet.",
  generateBatchHint: "Generate a batch under Module quiz below.",
  moduleQuizBankScope: "Module {id} · Module quiz bank",

  // Module quiz section
  moduleQuizDescBefore:
    "Uses the shared module bank only. For cards from your notes, open the ",
  moduleQuizDescAfter: " tab.",
  generatingQuestions: "Generating questions…",
  generateMoreQuestions: "Generate more questions (AI)",
  bankCountOne: "Bank: 1 question in this module",
  bankCount: "Bank: {count} questions in this module",
  noQuestionsYetGenerate:
    "No questions yet — generate a batch to start the quiz.",
  bankManagedByCreator: "Question bank is managed by the course creator.",
  bankCountShortOne: "Bank: 1 question.",
  bankCountShort: "Bank: {count} questions.",
  noQuestionsInModule: "No questions in this module yet.",
  reviewQueueOne: "Review queue — 1 question",
  reviewQueue: "Review queue — {count} questions",
  reviewQueueDesc:
    "Still weak on your last try — they'll appear first in your next quiz until you answer them correctly.",
  moreInModule: "+{count} more in this module",
  finishFocusQuizFirst: "Finish your focus quiz first",
  startModuleQuiz: "Start module quiz",
  moduleQuizRun: "Module quiz run",
  backToOverview: "← Back to overview",
  backToLecture: "← Lecture",

  // Practice progress pull tab
  thisCourse: "This course",
  modulesDetailLineOne:
    "{completed}/{total} modules · 1 material · matches Profile → Progress",
  modulesDetailLine:
    "{completed}/{total} modules · {count} materials · matches Profile → Progress",

  // Errors / dialogs
  couldNotGenerateQuestions: "Could not generate new questions.",
  networkError: "Network error.",
  titleLengthError: "Title must be 1–200 characters.",
  couldNotRename: "Could not rename.",
  couldNotDelete: "Could not delete.",
  deleteModuleTitle: "Delete this module?",
  deleteModuleBody:
    "Remaining modules will be renumbered. Progress and quiz attempts for this upload will be reset.",

  // Module quiz run (ModuleQuiz)
  noMisses: "No misses this pass",
  missCountOne: "1 miss — review it later from your queue",
  missCount: "{count} misses — review them later from your queue",
  mixedReviewComplete: "Mixed review complete",
  mixedReviewCompleteBody:
    "You finished this pass — {count} questions drawn at random from every module and upload in this course. Attempts are saved to each question's home module.",
  closing: "Closing…",
  backToPracticeRoom: "Back to practice room",
  moduleQuizComplete: "Module quiz complete",
  moduleQuizCompleteBody:
    "You finished this pass — {count} questions. Missed items stay in your review queue for next time.",
  progressSavedChoose:
    "Progress is saved when you finish this pass. Choose whether to reread the lessons or jump ahead.",
  practiceAgain: "Practice again",
  saving: "Saving…",
  reviewLessonsAgain: "Review lessons again",
  nextModule: "Next module →",
  moveToNextUpload: "Move to next upload",
  allModulesFinishedBefore:
    "You've finished all modules in this upload. Use ",
  allModulesFinishedAfter:
    " to revisit, or navigate to another upload from the sidebar.",
  noQuizQuestions: "No quiz questions for this module.",
  singlePassLabel: "Single pass:",
  singlePassBody:
    "answer each question once. If you miss, you'll move on — missed questions are logged and prioritized in your next run or in the review queue below the lessons.",
  questionXofY: "Question {current} of {total}",
  multipleChoice: "multiple choice",
  shortAnswer: "short answer",
  missesSoFar: "{count} misses so far",
  correct: "Correct.",
  incorrectSavedForReview:
    "Incorrect — saved for review. Read the explanation, then continue.",
  readFeedback: "Read feedback…",
  seeResults: "See results",
  continue: "Continue",
  yourAnswer: "Your answer",
  answerPlaceholder: "Type your answer in your own words…",
  checking: "Checking…",
  submitAnswer: "Submit answer",
  couldNotGrade: "Could not grade. Try again.",
  networkErrorTryAgain: "Network error. Try again.",
  looksGood: "Looks good.",
  keepRefining: "Keep refining your answer.",
  correctWellDone: "Correct — well done.",
  feedback: "Feedback",
  lessonReminder: "Lesson reminder:",

  // Simple MCQ session (McqQuiz)
  sessionComplete: "Session complete",
  sessionCompleteBody:
    "You answered {correct} out of {total} questions correctly.",
  scoreCorrectIncorrect: "{correct} correct · {wrong} incorrect",
  resultsSaved:
    "Results are saved so you can pick up where you left off anytime.",
  noQuestionsLoaded: "No questions loaded for this material.",
  notQuiteReview: "Not quite — review the explanation below.",
  nextQuestion: "Next question",
};

const ko: typeof en = {
  // Sidebar / course chrome
  lessons: "레슨",
  yourCourse: "내 코스",
  course: "코스",
  showMore: "더 보기",
  showLess: "접기",
  thisUpload: "이 자료",
  modulesProgress: "{completed}/{total} 모듈",
  wholeCourseMixedQuiz: "코스 전체 혼합 퀴즈",
  allMaterials: "전체 자료",
  curriculum: "커리큘럼",
  section: "섹션",
  other: "기타",
  viewing: "보는 중",
  moduleTitle: "모듈 제목",
  save: "저장",
  cancel: "취소",
  rename: "이름 변경",
  delete: "삭제",
  sourceFile: "원본 파일:",
  noModules: "이 코스에 모듈이 없어요.",
  hideModules: "모듈 숨기기",
  showModules: "모듈 보기",

  // Refine-applied flash banner
  updatingStudyContent: "학습 콘텐츠 업데이트 중",
  mergingEdits: "수정한 내용을 이 페이지에 반영하고 있어요…",

  // Mode toggle
  modeToggleHint:
    "멘토 학습은 집중 튜터링 화면에서 열리고, 자유 탐색은 지금 보고 있는 읽기 모드예요.",

  // Module header / lesson navigation
  moduleLabel: "모듈 {id}",
  jumpToLesson: "레슨으로 이동",
  jumpToLessonPlaceholder: "레슨으로 이동…",

  // Practice & review card (lessons mode)
  practiceAndReview: "연습 및 복습",
  practiceAndReviewBody:
    "연습실에서 모듈 퀴즈나 포커스 카드를 풀어 보세요 — 그곳의 탭으로 서로 전환할 수 있어요.",
  moduleCompleteBanner:
    "모듈 완료 — 연습실에서 언제든 문제를 다시 풀 수 있어요.",
  goToPracticeRoom: "연습실로 가기",

  // Practice page header / tabs
  practiceIntroBeforeModule: "아래 탭으로 전환하세요 — ",
  practiceIntroBetween: "는 공용 문제은행이고, ",
  practiceIntroAfter: "는 노트로 만든 나만의 카드예요.",
  practiceType: "연습 유형",
  moduleQuiz: "모듈 퀴즈",
  focusQuiz: "포커스 퀴즈",

  // Module bank review
  moduleBankReview: "모듈 문제은행 복습",
  moduleBankReviewDesc:
    "이 모듈의 공용 문제예요(아래 퀴즈와 같은 문제 풀). 포커스 카드는 포커스 퀴즈 탭에 있어요.",
  noBankQuestions: "이 모듈에는 아직 문제은행 문제가 없어요.",
  generateBatchHint: "아래 모듈 퀴즈에서 문제를 생성해 보세요.",
  moduleQuizBankScope: "모듈 {id} · 모듈 퀴즈 문제은행",

  // Module quiz section
  moduleQuizDescBefore:
    "공용 모듈 문제은행만 사용해요. 노트로 만든 카드는 ",
  moduleQuizDescAfter: " 탭에서 확인하세요.",
  generatingQuestions: "문제 생성 중…",
  generateMoreQuestions: "문제 더 생성하기 (AI)",
  bankCountOne: "문제은행: 이 모듈에 문제 1개",
  bankCount: "문제은행: 이 모듈에 문제 {count}개",
  noQuestionsYetGenerate:
    "아직 문제가 없어요 — 문제를 생성해 퀴즈를 시작하세요.",
  bankManagedByCreator: "문제은행은 코스 제작자가 관리해요.",
  bankCountShortOne: "문제은행: 문제 1개.",
  bankCountShort: "문제은행: 문제 {count}개.",
  noQuestionsInModule: "이 모듈에는 아직 문제가 없어요.",
  reviewQueueOne: "복습 대기열 — 문제 1개",
  reviewQueue: "복습 대기열 — 문제 {count}개",
  reviewQueueDesc:
    "지난 시도에서 틀린 문제예요 — 정답을 맞힐 때까지 다음 퀴즈에서 먼저 나와요.",
  moreInModule: "이 모듈에 {count}개 더 있어요",
  finishFocusQuizFirst: "포커스 퀴즈를 먼저 끝내 주세요",
  startModuleQuiz: "모듈 퀴즈 시작",
  moduleQuizRun: "모듈 퀴즈 진행",
  backToOverview: "← 개요로 돌아가기",
  backToLecture: "← 강의",

  // Practice progress pull tab
  thisCourse: "이 코스",
  modulesDetailLineOne:
    "{completed}/{total} 모듈 · 자료 1개 · 프로필 → 진행 상황과 동일",
  modulesDetailLine:
    "{completed}/{total} 모듈 · 자료 {count}개 · 프로필 → 진행 상황과 동일",

  // Errors / dialogs
  couldNotGenerateQuestions: "새 문제를 생성하지 못했어요.",
  networkError: "네트워크 오류가 발생했어요.",
  titleLengthError: "제목은 1–200자여야 해요.",
  couldNotRename: "이름을 변경하지 못했어요.",
  couldNotDelete: "삭제하지 못했어요.",
  deleteModuleTitle: "이 모듈을 삭제할까요?",
  deleteModuleBody:
    "남은 모듈의 번호가 다시 매겨져요. 이 자료의 진행 상황과 퀴즈 기록은 초기화돼요.",

  // Module quiz run (ModuleQuiz)
  noMisses: "이번 회차에 틀린 문제가 없어요",
  missCountOne: "1문제 틀렸어요 — 나중에 대기열에서 복습하세요",
  missCount: "{count}문제 틀렸어요 — 나중에 대기열에서 복습하세요",
  mixedReviewComplete: "혼합 복습 완료",
  mixedReviewCompleteBody:
    "이번 회차를 끝냈어요 — 이 코스의 모든 모듈과 자료에서 무작위로 뽑은 {count}문제였어요. 시도 기록은 각 문제가 속한 모듈에 저장돼요.",
  closing: "닫는 중…",
  backToPracticeRoom: "연습실로 돌아가기",
  moduleQuizComplete: "모듈 퀴즈 완료",
  moduleQuizCompleteBody:
    "이번 회차를 끝냈어요 — 총 {count}문제였어요. 틀린 문제는 다음을 위해 복습 대기열에 남아요.",
  progressSavedChoose:
    "이번 회차를 마치면 진행 상황이 저장돼요. 레슨을 다시 읽을지, 다음으로 넘어갈지 선택하세요.",
  practiceAgain: "다시 연습하기",
  saving: "저장 중…",
  reviewLessonsAgain: "레슨 다시 보기",
  nextModule: "다음 모듈 →",
  moveToNextUpload: "다음 자료로 이동",
  allModulesFinishedBefore: "이 자료의 모든 모듈을 마쳤어요. 다시 보려면 ",
  allModulesFinishedAfter:
    "를 누르거나 사이드바에서 다른 자료로 이동하세요.",
  noQuizQuestions: "이 모듈에는 퀴즈 문제가 없어요.",
  singlePassLabel: "한 번만 답하기:",
  singlePassBody:
    "각 문제에 한 번씩만 답해요. 틀려도 다음으로 넘어가요 — 틀린 문제는 기록되어 다음 회차나 레슨 아래 복습 대기열에서 먼저 나와요.",
  questionXofY: "문제 {current} / {total}",
  multipleChoice: "객관식",
  shortAnswer: "주관식",
  missesSoFar: "지금까지 {count}문제 틀렸어요",
  correct: "정답이에요.",
  incorrectSavedForReview:
    "오답이에요 — 복습용으로 저장했어요. 해설을 읽고 계속하세요.",
  readFeedback: "해설을 읽어 주세요…",
  seeResults: "결과 보기",
  continue: "계속",
  yourAnswer: "내 답변",
  answerPlaceholder: "자신의 말로 답을 입력하세요…",
  checking: "채점 중…",
  submitAnswer: "답변 제출",
  couldNotGrade: "채점하지 못했어요. 다시 시도해 주세요.",
  networkErrorTryAgain: "네트워크 오류예요. 다시 시도해 주세요.",
  looksGood: "좋아요.",
  keepRefining: "답변을 조금 더 다듬어 보세요.",
  correctWellDone: "정답이에요 — 잘했어요.",
  feedback: "피드백",
  lessonReminder: "레슨 복습:",

  // Simple MCQ session (McqQuiz)
  sessionComplete: "세션 완료",
  sessionCompleteBody: "{total}문제 중 {correct}문제를 맞혔어요.",
  scoreCorrectIncorrect: "정답 {correct} · 오답 {wrong}",
  resultsSaved: "결과가 저장되어 언제든 이어서 할 수 있어요.",
  noQuestionsLoaded: "이 자료에 불러온 문제가 없어요.",
  notQuiteReview: "아쉬워요 — 아래 해설을 확인하세요.",
  nextQuestion: "다음 문제",
};

export const study = { en, ko };
