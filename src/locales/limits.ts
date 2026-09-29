/**
 * Plan-limit copy ("you ran out") for every monthly/daily meter. Built on the
 * server in the student's app language by `src/lib/billing/limit-messages.ts`,
 * so any UI that shows the server's `error` text is already localized.
 */
const en = {
  resetFallback: "your next billing date",
  planLite: "Lite",
  planStudent: "Student",
  planPlus: "Plus",
  planPro: "Pro",
  planMax: "Max",
  hourOne: "1 hour",
  hoursMany: "{hours} hours",
  minuteOne: "1 minute",
  minutesMany: "{minutes} minutes",
  aboutMinuteOne: "about 1 minute",
  aboutMinutesMany: "about {minutes} minutes",
  aboutHourOne: "about 1 hour",
  aboutHoursMany: "about {hours} hours",

  chatUsedUp:
    "You've reached your monthly chat limit ({count} messages with Rose). It resets on {date}.",
  chatUnavailable: "Chat with Rose isn't included right now. It resets on {date}.",
  chatChoosePlan: "Choose a plan to get more messages each month.",
  chatUpgrade: "Upgrade your plan for more messages each month.",

  pagesChoosePlan: "Choose a plan to build courses from your files.",
  pagesUsedUp:
    "You've used all {cap} pages of course material in your {plan} plan. They reset on {date}.",
  pagesUpgrade: "Upgrade your plan for more pages.",
  pagesShort:
    "These files have {needed} pages, but you have {left} pages of course material left. Remove some files, wait until your pages reset on {date}, or upgrade your plan for more pages.",
  pagesShortTopPlan:
    "These files have {needed} pages, but you have {left} pages of course material left. Remove some files, or wait until your pages reset on {date}.",
  buildChoosePlan: "Choose a plan to build a course.",

  lectureChoosePlan: "Choose a plan to take live lecture notes.",
  lectureUsedUp:
    "You've used all {hours} of live lecture notes in your {plan} plan. They reset on {date}.",
  lectureUpgrade: "Upgrade your plan for more lecture hours.",
  lectureWarning:
    "About {minutes} of live lecture notes left on your plan. Recording stops by itself at the limit, and everything so far is saved.",
  lectureStopped:
    "You've used your plan's live lecture hours for this month, so recording stopped. Your transcript and notes are saved and you can still finish them. Hours reset with your plan each month, or upgrade for more.",

  extraChoosePlan: "Choose a plan to generate extra practice questions.",
  extraUsedUp:
    "You've used all {cap} extra question sets in your {plan} plan. They reset on {date}.",
  extraUpgrade: "Upgrade your plan for more question sets.",
  extraDaily:
    "You've made {cap} extra question sets today, which is the daily limit. You can make more in {wait}.",

  voiceCapUpgrade:
    "You've used all your voice time for this billing period. Switched to text — upgrade your plan for more voice minutes.",
  voiceCap:
    "You've used your voice allowance for this month. Switched to text — you can keep studying everything else.",
};

const ko: typeof en = {
  resetFallback: "다음 결제일",
  planLite: "라이트",
  planStudent: "스튜던트",
  planPlus: "플러스",
  planPro: "프로",
  planMax: "맥스",
  hourOne: "1시간",
  hoursMany: "{hours}시간",
  minuteOne: "1분",
  minutesMany: "{minutes}분",
  aboutMinuteOne: "약 1분",
  aboutMinutesMany: "약 {minutes}분",
  aboutHourOne: "약 1시간",
  aboutHoursMany: "약 {hours}시간",

  chatUsedUp:
    "이번 달 Rose 채팅 한도({count}개 메시지)를 모두 사용했어요. {date}에 초기화돼요.",
  chatUnavailable: "지금은 Rose 채팅이 포함되어 있지 않아요. {date}에 초기화돼요.",
  chatChoosePlan: "요금제를 선택하면 매달 더 많은 메시지를 보낼 수 있어요.",
  chatUpgrade: "요금제를 업그레이드하면 매달 더 많은 메시지를 보낼 수 있어요.",

  pagesChoosePlan: "파일로 코스를 만들려면 요금제를 선택하세요.",
  pagesUsedUp:
    "{plan} 요금제의 코스 자료 {cap}페이지를 모두 사용했어요. {date}에 초기화돼요.",
  pagesUpgrade: "더 많은 페이지가 필요하면 요금제를 업그레이드하세요.",
  pagesShort:
    "이 파일들은 {needed}페이지인데, 남은 코스 자료는 {left}페이지예요. 파일을 일부 빼거나, {date}에 페이지가 초기화될 때까지 기다리거나, 요금제를 업그레이드해 더 많은 페이지를 받으세요.",
  pagesShortTopPlan:
    "이 파일들은 {needed}페이지인데, 남은 코스 자료는 {left}페이지예요. 파일을 일부 빼거나 {date}에 페이지가 초기화될 때까지 기다려 주세요.",
  buildChoosePlan: "코스를 만들려면 요금제를 선택하세요.",

  lectureChoosePlan: "실시간 강의 노트를 쓰려면 요금제를 선택하세요.",
  lectureUsedUp:
    "{plan} 요금제의 실시간 강의 노트 {hours}을 모두 사용했어요. {date}에 초기화돼요.",
  lectureUpgrade: "더 많은 강의 시간이 필요하면 요금제를 업그레이드하세요.",
  lectureWarning:
    "요금제의 실시간 강의 노트가 약 {minutes} 남았어요. 한도에 도달하면 녹음이 자동으로 멈추고, 지금까지의 내용은 모두 저장돼요.",
  lectureStopped:
    "이번 달 요금제의 실시간 강의 시간을 모두 사용해서 녹음이 멈췄어요. 녹취록과 노트는 저장되어 있고 계속 마무리할 수 있어요. 강의 시간은 매달 요금제와 함께 초기화되며, 업그레이드하면 더 받을 수 있어요.",

  extraChoosePlan: "추가 연습 문제를 만들려면 요금제를 선택하세요.",
  extraUsedUp:
    "{plan} 요금제의 추가 문제 세트 {cap}회를 모두 사용했어요. {date}에 초기화돼요.",
  extraUpgrade: "더 많은 문제 세트가 필요하면 요금제를 업그레이드하세요.",
  extraDaily:
    "오늘 추가 문제 세트를 {cap}회 만들어 하루 한도에 도달했어요. {wait} 후에 더 만들 수 있어요.",

  voiceCapUpgrade:
    "이번 결제 기간의 음성 시간을 모두 사용했어요. 텍스트 모드로 전환했어요 — 더 많은 음성 시간이 필요하면 요금제를 업그레이드하세요.",
  voiceCap:
    "이번 달 음성 사용량을 모두 사용했어요. 텍스트 모드로 전환했어요 — 다른 학습은 계속할 수 있어요.",
};

export const limits = { en, ko };
