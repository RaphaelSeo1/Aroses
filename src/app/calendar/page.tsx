import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; chat?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/calendar");
  }

  const params = await searchParams;
  const day =
    typeof params.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.day)
      ? params.day
      : undefined;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="px-4 py-8 sm:px-6 sm:py-10">
          <CalendarPageClient
            initialDay={day}
            openChat={params.chat === "1"}
          />
        </div>
      </main>
    </>
  );
}
