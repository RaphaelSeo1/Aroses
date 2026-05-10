import { redirect } from "next/navigation";

/** Progress UI lives on Profile → Progress tab. */
export default function ProgressRedirectPage() {
  redirect("/dashboard/profile?tab=progress");
}
