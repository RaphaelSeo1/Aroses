const en = {
  title: "Daily check-in",
  hint: "Come back each local day. 30 days in a row unlocks a month of Plus.",
  cta: "Check in",
  ctaShort: "Check in",
  checking: "Checking in…",
  checkedIn: "Checked in",
  comeBackTomorrow: "Come back tomorrow",
  streakOne: "{count}-day streak",
  streakMany: "{count}-day streak",
  progress: "{current}/{goal} toward Plus",
  progressDone: "Plus month unlocked",
  rewardHint: "30 consecutive days → one free month of Plus.",
  celebrationTitle: "You're here.",
  celebrationBody: "{streak}-day streak. See you tomorrow.",
  celebrationPlusTitle: "Plus is yours for a month",
  celebrationPlusBody:
    "Thirty days in a row — course gens, pages, and voice on Plus until {date}.",
  celebrationPlusSkipped:
    "Thirty days in a row. You already have Plus or higher, so nothing changed on your plan.",
  chipAriaDue: "Check in for today",
  chipAriaDone: "Daily check-in, {count}-day streak",
  errorGeneric: "Could not check in. Try again.",
  timezoneNote: "Streaks use your local calendar day.",
};

const ko: typeof en = {
  title: "매일 체크인",
  hint: "현지 날짜 기준으로 매일 들러 주세요. 30일 연속이면 Plus 한 달을 드려요.",
  cta: "체크인",
  ctaShort: "체크인",
  checking: "체크인 중…",
  checkedIn: "오늘 체크인했어요",
  comeBackTomorrow: "내일 다시 와 주세요",
  streakOne: "{count}일 연속",
  streakMany: "{count}일 연속",
  progress: "Plus까지 {current}/{goal}",
  progressDone: "Plus 한 달 잠금 해제",
  rewardHint: "30일 연속 → Plus 한 달.",
  celebrationTitle: "오늘도 왔군요.",
  celebrationBody: "{streak}일 연속이에요. 내일 또 만나요.",
  celebrationPlusTitle: "Plus 한 달을 드렸어요",
  celebrationPlusBody:
    "30일 연속 체크인 — {date}까지 Plus의 코스 생성·페이지·음성을 쓸 수 있어요.",
  celebrationPlusSkipped:
    "30일 연속이에요. 이미 Plus 이상이어서 요금제는 그대로예요.",
  chipAriaDue: "오늘 체크인하기",
  chipAriaDone: "매일 체크인, {count}일 연속",
  errorGeneric: "체크인하지 못했어요. 다시 시도해 주세요.",
  timezoneNote: "연속 기록은 내 현지 날짜를 기준으로 해요.",
};

export const checkin = { en, ko };
