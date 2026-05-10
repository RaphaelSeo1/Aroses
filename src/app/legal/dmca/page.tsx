import type { Metadata } from "next";
import { LegalDocLayout } from "@/components/LegalDocLayout";
import { APP_NAME } from "@/lib/brand";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal-contact";

export const metadata: Metadata = {
  title: `DMCA Policy — ${APP_NAME}`,
  description: `Copyright / DMCA policy for ${APP_NAME}.`,
};

export default function DmcaPage() {
  return (
    <LegalDocLayout title="DMCA / Copyright policy">
      <>
        <p>
          {APP_NAME} respects intellectual property rights. We respond to notices of
          alleged copyright infringement that comply with the U.S. Digital Millennium
          Copyright Act (&quot;DMCA&quot;) where applicable.
        </p>

        <h2>Filing a DMCA notice</h2>
        <p>
          If you believe material on the Service infringes your copyright, send a
          written notice that includes substantially the following:
        </p>
        <ul>
          <li>
            Identification of the copyrighted work claimed to have been infringed.
          </li>
          <li>
            Identification of the material that is claimed to be infringing and
            information reasonably sufficient to locate it (e.g., URL or description).
          </li>
          <li>Your contact information (name, address, telephone number, email).</li>
          <li>
            A statement that you have a good faith belief that use of the material is
            not authorized by the copyright owner, its agent, or the law.
          </li>
          <li>
            A statement that the information in the notification is accurate, and under
            penalty of perjury, that you are authorized to act on behalf of the copyright
            owner.
          </li>
          <li>A physical or electronic signature of the copyright owner or agent.</li>
        </ul>

        <h2>Designated agent</h2>
        <p>
          Send DMCA notices to the contact below. You may also use this contact for
          other copyright-related inquiries.
        </p>
        <p>
          {LEGAL_CONTACT_EMAIL ? (
            <>
              Email:{" "}
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=DMCA%20Notice`}
                className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
              >
                {LEGAL_CONTACT_EMAIL}
              </a>
            </>
          ) : (
            <>
              Configure{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                NEXT_PUBLIC_LEGAL_EMAIL
              </code>{" "}
              for your designated copyright agent inbox (often legal@ or dmca@ your
              domain).
            </>
          )}
        </p>
        <p>
          <strong>Optional:</strong> Add a postal address for your designated agent
          here once you have one — many registrations require both email and physical
          address for the DMCA agent.
        </p>

        <h2>Counter-notification</h2>
        <p>
          If you believe material was removed in error, you may submit a counter-notice
          that meets DMCA requirements. We may restore material after applicable waiting
          periods unless the complaining party seeks a court order.
        </p>

        <h2>Repeat infringers</h2>
        <p>
          We may terminate or suspend accounts that we determine, in appropriate
          circumstances, are repeat infringers.
        </p>

        <p className="text-zinc-600 dark:text-zinc-400">
          This policy is provided for informational purposes and does not constitute
          legal advice. Consult counsel for compliance with the DMCA and applicable
          law.
        </p>
      </>
    </LegalDocLayout>
  );
}
