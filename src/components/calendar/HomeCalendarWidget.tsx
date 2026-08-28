"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarMonthGrid } from "@/components/calendar/CalendarMonthGrid";
import { useCalendarItems } from "@/components/calendar/use-calendar-items";
import { itemDateKey, localDateKey } from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";

export function HomeCalendarWidget() {
  const t = useT();
  const router = useRouter();
  const { items } = useCalendarItems();
  const [cursor, setCursor] = useState(() => new Date());
  const today = useMemo(() => new Date(), []);

  const markedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const key = itemDateKey(item.startsAt);
      if (key) set.add(key);
    }
    return set;
  }, [items]);

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-4 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t.calendar.title}
        </p>
        <Link
          href="/calendar"
          className="shrink-0 text-[11px] font-semibold text-brand hover:underline dark:text-brand-soft"
        >
          {t.calendar.expand}
        </Link>
      </div>
      <div className="mx-auto mt-2 w-full max-w-[14rem]">
        <CalendarMonthGrid
          compact
          cursor={cursor}
          selected={today}
          markedKeys={markedKeys}
          onSelect={(d) => {
            router.push(`/calendar?day=${localDateKey(d)}`);
          }}
          onPrev={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
          }
          onNext={() =>
            setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
          }
        />
      </div>
    </section>
  );
}
