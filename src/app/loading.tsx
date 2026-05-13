import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { MainRouteSkeleton } from "@/components/MainRouteSkeleton";

/** Shown during navigations into the root segment until the page RSC resolves. */
export default function AppLoading() {
  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <MainRouteSkeleton />
    </>
  );
}
