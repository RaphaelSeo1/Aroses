import { redirect } from "next/navigation";

export default function FriendsPage() {
  redirect("/dashboard/profile?tab=friends");
}
