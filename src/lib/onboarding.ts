export type OnboardingPersona =
  | "student"
  | "educator"
  | "professional"
  | "self_learner";

export type OnboardingGoal =
  | "exam_prep"
  | "understand"
  | "ahead"
  | "skill"
  | "create_share"
  | "explore";

export type OnboardingReferral =
  | "friend"
  | "social"
  | "google"
  | "teacher"
  | "other";

export type OnboardingPhase =
  | "welcome"
  | "persona"
  | "goals"
  | "school"
  | "username"
  | "dob"
  | "referral"
  | "done";

const PHASE_ORDER: OnboardingPhase[] = [
  "welcome",
  "persona",
  "goals",
  "school",
  "username",
  "dob",
  "referral",
  "done",
];

export function showSchoolPhase(persona: OnboardingPersona | null): boolean {
  return persona === "student" || persona === "educator";
}

export function phasesForPersona(
  persona: OnboardingPersona | null
): OnboardingPhase[] {
  const skipSchool = !showSchoolPhase(persona);
  return PHASE_ORDER.filter((p) => !(skipSchool && p === "school"));
}

/** Maps onboarding persona to existing `profiles.study_focus` values. */
export function personaToStudyFocus(
  persona: OnboardingPersona
): "student" | "instructor" | "professional" | "hobby" {
  switch (persona) {
    case "student":
      return "student";
    case "educator":
      return "instructor";
    case "professional":
      return "professional";
    case "self_learner":
      return "hobby";
  }
}

export const ONBOARDING_GOALS: {
  id: OnboardingGoal;
  label: string;
  emoji: string;
}[] = [
  { id: "exam_prep", label: "Study for exams", emoji: "📝" },
  { id: "understand", label: "Understand my course material better", emoji: "📖" },
  { id: "ahead", label: "Get ahead in my classes", emoji: "🚀" },
  { id: "skill", label: "Master a specific skill", emoji: "🎯" },
  { id: "create_share", label: "Create and share my own courses", emoji: "📚" },
  { id: "explore", label: "Explore what others have made", emoji: "🔍" },
];

export const ONBOARDING_PERSONAS: {
  id: OnboardingPersona;
  label: string;
  hint: string;
  emoji: string;
}[] = [
  {
    id: "student",
    label: "Student",
    hint: "Taking classes at a university or high school",
    emoji: "🎓",
  },
  {
    id: "educator",
    label: "Educator",
    hint: "Professor, teacher, or tutor",
    emoji: "👨‍🏫",
  },
  {
    id: "professional",
    label: "Professional",
    hint: "Learning for work or career growth",
    emoji: "💼",
  },
  {
    id: "self_learner",
    label: "Self-learner",
    hint: "Learning for personal interest",
    emoji: "🌱",
  },
];

export const ONBOARDING_REFERRALS: {
  id: OnboardingReferral;
  label: string;
  emoji: string;
}[] = [
  { id: "friend", label: "A friend or classmate", emoji: "👥" },
  { id: "social", label: "Social media", emoji: "📱" },
  { id: "google", label: "Google search", emoji: "🔍" },
  { id: "teacher", label: "A professor or teacher", emoji: "👨‍🏫" },
  { id: "other", label: "Other", emoji: "📢" },
];

export function parseUsername(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(t)) return null;
  return t;
}

export function ageFromYmd(
  y: number,
  m: number,
  d: number,
  now = new Date()
): number {
  const b = new Date(y, m - 1, d);
  if (
    b.getFullYear() !== y ||
    b.getMonth() !== m - 1 ||
    b.getDate() !== d
  ) {
    return NaN;
  }
  let age = now.getFullYear() - y;
  const md = now.getMonth() - (m - 1);
  if (md < 0 || (md === 0 && now.getDate() < d)) age -= 1;
  return age;
}
