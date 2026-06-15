const en = {
  logIn: "Log in",
  welcomeBack: "Welcome back to {app}.",
  signUp: "Sign up",
  createYourAccount: "Create your account",
  startStudyingSmarter: "Start studying smarter with {app}.",
  email: "Email",
  password: "Password",
  orEmail: "or email",
  signingIn: "Signing in…",
  creating: "Creating…",
  redirecting: "Redirecting…",
  loading: "Loading…",
  notApproved: "That account isn't approved for this site.",
  signInWithAllowedEmail: "Sign in with an email your administrator allowed.",
  emailPasswordDisabled:
    "Email/password sign-in is disabled for this deployment — use Google above.",
  signUpWithGoogle: "Sign up with Google",
  continueWithGoogle: "Continue with Google",
  acceptTermsToContinue: "Accept the terms above to continue with Google.",
  confirmLegalFirst:
    "Please confirm your age and accept the Terms and Privacy Policy.",
  checkEmailToConfirm:
    "Check your email to confirm your account, or log in if confirmation is disabled.",
  // Age/legal consent sentence, split so each language can order it naturally.
  legalPrefix: "I am at least 13 years old and I agree to the ",
  legalTerms: "Terms of Service",
  legalJoin: " and ",
  legalPrivacy: "Privacy Policy",
  legalSuffix: ".",

  // Reset password
  resetTitle: "Set a new password",
  resetBody: "Choose a strong password for your account.",
  newPassword: "New password",
  confirmPassword: "Confirm password",
  passwordMin8: "Password must be at least 8 characters.",
  passwordsMismatch: "Passwords do not match.",
  updatePassword: "Update password",
};

const ko: typeof en = {
  logIn: "로그인",
  welcomeBack: "{app}에 다시 오신 것을 환영해요.",
  signUp: "회원가입",
  createYourAccount: "계정 만들기",
  startStudyingSmarter: "{app}와 함께 더 똑똑하게 공부를 시작하세요.",
  email: "이메일",
  password: "비밀번호",
  orEmail: "또는 이메일로",
  signingIn: "로그인 중…",
  creating: "계정 생성 중…",
  redirecting: "이동 중…",
  loading: "불러오는 중…",
  notApproved: "이 계정은 이 사이트에서 승인되지 않았어요.",
  signInWithAllowedEmail: "관리자가 허용한 이메일로 로그인해 주세요.",
  emailPasswordDisabled:
    "이 배포에서는 이메일/비밀번호 로그인이 비활성화되어 있어요 — 위의 Google 로그인을 이용해 주세요.",
  signUpWithGoogle: "Google로 회원가입",
  continueWithGoogle: "Google로 계속하기",
  acceptTermsToContinue: "Google로 계속하려면 위 약관에 동의해 주세요.",
  confirmLegalFirst: "나이 확인과 이용약관 및 개인정보처리방침 동의가 필요해요.",
  checkEmailToConfirm:
    "이메일을 확인해 계정을 인증해 주세요. 인증이 꺼져 있다면 바로 로그인할 수 있어요.",
  legalPrefix: "만 13세 이상이며 ",
  legalTerms: "이용약관",
  legalJoin: " 및 ",
  legalPrivacy: "개인정보처리방침",
  legalSuffix: "에 동의합니다.",

  resetTitle: "새 비밀번호 설정",
  resetBody: "계정에 사용할 안전한 비밀번호를 정해 주세요.",
  newPassword: "새 비밀번호",
  confirmPassword: "비밀번호 확인",
  passwordMin8: "비밀번호는 8자 이상이어야 해요.",
  passwordsMismatch: "비밀번호가 일치하지 않아요.",
  updatePassword: "비밀번호 변경",
};

export const auth = { en, ko };
