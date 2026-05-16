import type { Metadata } from "next";
import { LegalDocLayout } from "@/components/LegalDocLayout";
import { APP_NAME } from "@/lib/brand";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal-contact";

export const metadata: Metadata = {
  title: `Privacy Policy — ${APP_NAME}`,
  description: `Privacy Policy for ${APP_NAME}.`,
};

export default function PrivacyPage() {
  return (
    <LegalDocLayout title="Privacy Policy">
      <>
        <p>
          {`This Privacy Policy describes how ${APP_NAME} ("we," "us") collects, uses, and shares information when you use our website and services (the "Service").`}
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> such as email address and
            authentication identifiers when you sign up or log in (we use Supabase for
            authentication).
          </li>
          <li>
            <strong>Content you upload:</strong> files (e.g., PDFs), course titles,
            descriptions, and generated study materials stored in connection with
            your account.
          </li>
          <li>
            <strong>Usage data:</strong> basic technical data such as device/browser
            type, IP address, and timestamps may be processed by our hosting and
            analytics providers as part of operating the Service.
          </li>
          <li>
            <strong>AI interactions:</strong> when you use AI features (e.g., study
            chat or course generation), prompts and context derived from your
            materials may be sent to our AI provider (e.g., Anthropic) to produce
            responses.
          </li>
        </ul>

        <h2>2. How we use information</h2>
        <ul>
          <li>To provide, maintain, and secure the Service.</li>
          <li>To process uploads and generate lessons, quizzes, and related features.</li>
          <li>To communicate with you about the Service (e.g., auth emails).</li>
          <li>To comply with law and enforce our Terms.</li>
        </ul>

        <h2>3. How we store data</h2>
        <p>
          Data is stored using infrastructure we configure (for example, Supabase for
          database and authentication). We use industry-standard practices appropriate
          to our stage of operations; no method of transmission or storage is 100%
          secure.
        </p>

        <h2>4. Third parties</h2>
        <p>
          We use subprocessors that process data on our behalf, including hosting,
          database/auth (e.g., Supabase), and AI inference (e.g., Anthropic Claude).
          Their use of data is governed by their respective policies and our
          agreements with them. We do not sell your personal information.
        </p>

        <h2>5. Children&apos;s privacy</h2>
        <p>
          The Service is not directed at children under 13. We do not knowingly
          collect personal information from children under 13. If you believe we have
          collected such information, contact us and we will take appropriate steps
          to delete it.
        </p>

        <h2>6. Your choices</h2>
        <ul>
          <li>
            You may request deletion of your account or certain data by contacting us
            (see below). Some information may be retained where required by law or for
            legitimate business purposes (e.g., security logs).
          </li>
          <li>
            You can stop using the Service at any time; deletion rights may vary by
            region (e.g., GDPR, CCPA).
          </li>
        </ul>

        <h2>7. International users</h2>
        <p>
          If you access the Service from outside the United States, your information
          may be processed in the United States or other jurisdictions where our
          providers operate.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update this Privacy Policy from time to time. We will update the
          date at the top of this page when we do.
        </p>

        <h2>9. Contact</h2>
        <p>
          {LEGAL_CONTACT_EMAIL ? (
            <>
              Privacy inquiries:{" "}
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
              >
                {LEGAL_CONTACT_EMAIL}
              </a>
            </>
          ) : (
            <>
              Add{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                NEXT_PUBLIC_LEGAL_EMAIL
              </code>{" "}
              to your environment for a contact link here.
            </>
          )}
        </p>
      </>
    </LegalDocLayout>
  );
}
