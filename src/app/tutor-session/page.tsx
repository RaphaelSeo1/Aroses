import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { TutorSessionStartScreen } from "@/components/tutor-session/TutorSessionStartScreen";
import { createClient } from "@/lib/supabase/server";

/**
 * Tutor Session start screen.
 *
 * Auth-gated. Renders the centered "What do you want to work on?"
 * card with optional text input + file uploads + mode-tag chips. On
 * submit the client posts to /api/tutor-session/start which returns
 * a session id; the client then routes to /tutor-session/active/[id].
 */
export default async function TutorSessionStartPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/tutor-session");
  }

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <TutorSessionStartScreen />
        </div>
      </main>
    </>
  );
}
