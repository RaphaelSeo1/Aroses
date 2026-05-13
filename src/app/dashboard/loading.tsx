import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { MainRouteSkeleton } from "@/components/MainRouteSkeleton";

export default function DashboardLoading() {
  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <MainRouteSkeleton />
    </>
  );
}
