import { redirect } from "next/navigation";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Billing lives under Profile → Plans & billing. Keep this route as a redirect. */
export default async function BillingPage({ searchParams }: PageProps) {
  if (!isBillingUiEnabled()) {
    redirect("/");
  }

  const sp = await searchParams;
  const q = new URLSearchParams();
  q.set("tab", "billing");
  for (const [key, value] of Object.entries(sp)) {
    if (key === "tab") continue;
    if (typeof value === "string" && value) q.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string" && value[0]) {
      q.set(key, value[0]);
    }
  }
  redirect(`/dashboard/profile?${q.toString()}`);
}
