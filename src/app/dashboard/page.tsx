import { redirect } from "next/navigation";

/** Workspace lives at `/` when signed in; keep `/dashboard` as a stable bookmark. */
export default function DashboardAliasPage() {
  redirect("/");
}
