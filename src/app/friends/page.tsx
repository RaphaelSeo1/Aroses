import { redirect } from "next/navigation";

export default function FriendsPage() {
  redirect("/dashboard/social?tab=friends");
}
