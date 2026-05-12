import {
  getSchoolGooglePreferredHint,
  isAuthEmailDomainAllowlistEnforced,
  isSchoolOnlyNoEmailPassword,
  parseAllowedAuthEmailDomains,
} from "@/lib/school-email-policy";
import { SignupPageClient } from "./SignupPageClient";

export default function SignupPage() {
  const allowedDomains = isAuthEmailDomainAllowlistEnforced()
    ? parseAllowedAuthEmailDomains()
    : [];
  const preferredHint = getSchoolGooglePreferredHint();
  const hideEmailPassword = isSchoolOnlyNoEmailPassword();

  return (
    <SignupPageClient
      allowedDomains={allowedDomains}
      preferredHint={preferredHint}
      hideEmailPassword={hideEmailPassword}
    />
  );
}
