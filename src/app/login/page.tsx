import {
  getSchoolGooglePreferredHint,
  isAuthEmailDomainAllowlistEnforced,
  isSchoolOnlyNoEmailPassword,
  parseAllowedAuthEmailDomains,
} from "@/lib/school-email-policy";
import { LoginPageClient } from "./LoginPageClient";

export default function LoginPage() {
  const allowedDomains = isAuthEmailDomainAllowlistEnforced()
    ? parseAllowedAuthEmailDomains()
    : [];
  const preferredHint = getSchoolGooglePreferredHint();
  const hideEmailPassword = isSchoolOnlyNoEmailPassword();

  return (
    <LoginPageClient
      allowedDomains={allowedDomains}
      preferredHint={preferredHint}
      hideEmailPassword={hideEmailPassword}
    />
  );
}
