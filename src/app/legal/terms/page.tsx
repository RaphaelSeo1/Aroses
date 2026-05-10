import type { Metadata } from "next";
import { LegalDocLayout } from "@/components/LegalDocLayout";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Terms of Service — ${APP_NAME}`,
  description: `Terms of Service for ${APP_NAME}.`,
};

export default function TermsPage() {
  return (
    <LegalDocLayout title="Terms of Service">
      <>
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use
          of {APP_NAME} (the &quot;Service&quot;), operated by us (&quot;we,&quot;
          &quot;us,&quot; or &quot;our&quot;). By creating an account or using the
          Service, you agree to these Terms.
        </p>

        <h2>1. Eligibility</h2>
        <p>
          You must be at least <strong>13 years old</strong> to use the Service. If
          you are between 13 and the age of majority where you live, you represent
          that your parent or guardian has reviewed and accepted these Terms on your
          behalf where required by law.
        </p>

        <h2>2. The Service is a study aid</h2>
        <p>
          {APP_NAME} provides tools to organize and study material you provide. It is{" "}
          <strong>not</strong> a substitute for instructors, institutions,
          professional academic advising, tutoring, medical or legal advice, or any
          licensed professional service. You are solely responsible for your academic
          decisions and outcomes.
        </p>

        <h2>3. Your content</h2>
        <p>You retain ownership of content you upload (&quot;Your Content&quot;).</p>
        <ul>
          <li>
            You are solely responsible for Your Content and for ensuring you have the
            rights to upload it (e.g., lecture notes you created, materials you are
            permitted to use).
          </li>
          <li>
            You grant us a limited license to host, process, store, and display Your
            Content solely to operate and improve the Service for you (including
            using third-party subprocessors such as AI providers as described in our
            Privacy Policy).
          </li>
          <li>
            You represent that Your Content does not violate applicable law or
            third-party rights (including copyright).
          </li>
        </ul>

        <h2>4. AI-generated output</h2>
        <p>
          Features of the Service may use artificial intelligence to generate
          lessons, quizzes, summaries, chat replies, or other output.{" "}
          <strong>
            AI output may be inaccurate, incomplete, or inappropriate for your
            situation.
          </strong>{" "}
          You must verify important information against authoritative sources and your
          course materials. We do not guarantee the accuracy, completeness, or fitness
          of AI output for any purpose.
        </p>

        <h2>5. Accounts and termination</h2>
        <p>
          We may suspend or terminate access to the Service at any time, with or
          without notice, for conduct that we believe violates these Terms, creates risk
          or legal exposure, or for operational reasons. You may stop using the Service
          at any time.
        </p>

        <h2>6. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE.&quot; TO
          THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, WHETHER
          EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, AND NON-INFRINGEMENT.
        </p>

        <h2>7. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, OR ANY
          LOSS OF PROFITS, DATA, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE
          OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF THESE TERMS
          OR THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID US
          FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B) FIFTY U.S.
          DOLLARS (US $50).
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update these Terms from time to time. We will post the updated date
          at the top of this page. Continued use after changes constitutes acceptance
          of the revised Terms.
        </p>

        <h2>9. Contact</h2>
        <p>
          For questions about these Terms, use the contact method posted on this site
          or the email address provided in our Privacy Policy once configured.
        </p>
      </>
    </LegalDocLayout>
  );
}
