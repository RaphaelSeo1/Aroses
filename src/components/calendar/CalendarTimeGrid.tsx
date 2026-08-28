"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  CALENDAR_DND_TYPE,
  DEFAULT_DURATION_MIN,
  GRID_HOURS,
  MIN_DURATION_MIN,
  PX_PER_HOUR,
  isAllDayOn,
  itemDurationMinutes,
  layoutTimedItems,
  minutesToY,
  yToMinutes,
} from "@/lib/calendar/grid";
import {
  formatTime,
  isoFromDateMinutes,
  localDateKey,
  minutesOfDay,
  sameDay,
  snapMinutes,
  weekdayShort,
} from "@/lib/calendar/dates";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem } from "@/types/calendar";

type DragState =
  | {
      mode: "create";
      dayKey: string;
      anchorMin: number;
      endMin: number;
    }
  | {
      mode: "move";
      itemId: string;
      dayKey: string;
      startMin: number;
      duration: number;
    }
  | {
      mode: "resize";
      itemId: string;
      dayKey: string;
      startMin: number;
      endMin: number;
    };

function hourLabel(hour: number): string {
  const d = new Date(2000, 0, 1, hour);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function eventTone(item: CalendarItem): string {
  if (item.completedAt) return "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  if (item.important) {
    return "bg-brand text-white";
  }
  if (item.kind === "todo") {
    return "bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100";
  }
  return "bg-sky-500 text-white dark:bg-sky-600";
}

export function CalendarTimeGrid({
  days,
  items,
  selected,
  onSelectDay,
  onOpenItem,
  onPlaceItem,
  onCreateRange,
}: {
  days: Date[];
  items: CalendarItem[];
  selected: Date;
  onSelectDay: (d: Date) => void;
  onOpenItem: (item: CalendarItem) => void;
  onPlaceItem: (
    item: CalendarItem,
    next: { startsAt: string; endsAt: string | null; allDay: boolean }
  ) => void;
  onCreateRange: (startsAt: string, endsAt: string) => void;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const moved = useRef(false);
  const skipClick = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 7 * PX_PER_HOUR - 8;
  }, [days[0] ? localDateKey(days[0]) : ""]);

  const dayKeys = days.map((d) => localDateKey(d));

  const layouts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof layoutTimedItems>>();
    for (const key of dayKeys) {
      map.set(key, layoutTimedItems(items, key));
    }
    return map;
  }, [items, dayKeys.join("|")]);

  const allDayByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const key of dayKeys) {
      map.set(
        key,
        items.filter((i) => isAllDayOn(i, key))
      );
    }
    return map;
  }, [items, dayKeys.join("|")]);

  const dayFromPoint = (clientX: number, clientY: number): Date | null => {
    const node = document
      .elementFromPoint(clientX, clientY)
      ?.closest("[data-cal-day]");
    const key = node?.getAttribute("data-cal-day");
    if (!key) return null;
    const idx = dayKeys.indexOf(key);
    return idx >= 0 ? days[idx]! : null;
  };

  const minsFromPoint = (clientY: number): number => {
    const body = bodyRef.current;
    if (!body) return 0;
    const y = clientY - body.getBoundingClientRect().top;
    return snapMinutes(yToMinutes(y));
  };

  const finishPointer = (state: DragState) => {
    if (state.mode === "create") {
      const a = Math.min(state.anchorMin, state.endMin);
      const b = Math.max(state.anchorMin, state.endMin);
      const end = b - a < MIN_DURATION_MIN ? a + DEFAULT_DURATION_MIN : b;
      const day = days[dayKeys.indexOf(state.dayKey)];
      if (!day) return;
      onCreateRange(isoFromDateMinutes(day, a), isoFromDateMinutes(day, end));
      return;
    }
    const item = itemsRef.current.find((i) => i.id === state.itemId);
    const day = days[dayKeys.indexOf(state.dayKey)];
    if (!item || !day) return;
    if (state.mode === "move") {
      const startsAt = isoFromDateMinutes(day, state.startMin);
      const endsAt = isoFromDateMinutes(day, state.startMin + state.duration);
      onPlaceItem(item, { startsAt, endsAt, allDay: false });
      return;
    }
    const endsAt = isoFromDateMinutes(
      day,
      Math.max(state.startMin + MIN_DURATION_MIN, state.endMin)
    );
    onPlaceItem(item, {
      startsAt: item.startsAt ?? isoFromDateMinutes(day, state.startMin),
      endsAt,
      allDay: false,
    });
  };

  const bindDrag = (state: DragState) => {
    moved.current = false;
    dragRef.current = state;
    setDrag(state);
    const onMove = (e: PointerEvent) => {
      moved.current = true;
      const day = dayFromPoint(e.clientX, e.clientY);
      const mins = Math.max(
        0,
        Math.min(GRID_HOURS * 60, minsFromPoint(e.clientY))
      );
      setDrag((prev) => {
        if (!prev) return prev;
        const next =
          prev.mode === "create"
            ? {
                ...prev,
                dayKey: day ? localDateKey(day) : prev.dayKey,
                endMin: mins,
              }
            : prev.mode === "move"
              ? {
                  ...prev,
                  dayKey: day ? localDateKey(day) : prev.dayKey,
                  startMin: Math.min(
                    mins,
                    GRID_HOURS * 60 - MIN_DURATION_MIN
                  ),
                }
              : { ...prev, endMin: mins };
        dragRef.current = next;
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const prev = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!prev) return;
      if (moved.current) skipClick.current = true;
      if (prev.mode === "create" || moved.current) finishPointer(prev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const dropOnDay = (
    e: DragEvent,
    day: Date,
    timed: boolean,
    clientY?: number
  ) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(CALENDAR_DND_TYPE);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (!timed) {
      onPlaceItem(item, {
        startsAt: isoFromDateMinutes(day, 9 * 60),
        endsAt: null,
        allDay: true,
      });
      return;
    }
    const mins = snapMinutes(
      yToMinutes((clientY ?? e.clientY) - (bodyRef.current?.getBoundingClientRect().top ?? 0))
    );
    const duration = itemDurationMinutes(item);
    const start = Math.max(0, Math.min(mins, GRID_HOURS * 60 - MIN_DURATION_MIN));
    onPlaceItem(item, {
      startsAt: isoFromDateMinutes(day, start),
      endsAt: isoFromDateMinutes(day, start + duration),
      allDay: false,
    });
  };

  const gridHeight = GRID_HOURS * PX_PER_HOUR;
  const nowMin = minutesOfDay(now);

  return (
    <div>
      <p className="mb-2 text-[11px] text-zinc-400">{t.calendar.gridHint}</p>
      <div className="grid grid-cols-[3.5rem_1fr] gap-0">
        <div />
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((d) => {
            const isToday = sameDay(d, now);
            const isSelected = sameDay(d, selected);
            return (
              <button
                key={localDateKey(d)}
                type="button"
                onClick={() => onSelectDay(d)}
                className={`border-b border-l border-zinc-100 px-1 py-1.5 text-left first:border-l-0 dark:border-zinc-800 ${
                  isSelected ? "bg-brand-blush/30 dark:bg-brand-blush/10" : ""
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {weekdayShort(d)}
                </p>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    isToday ? "text-brand" : "text-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {d.getDate()}
                </p>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-end pr-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          {t.calendar.allDay}
        </div>
        <div
          className="grid border-b border-zinc-100 dark:border-zinc-800"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((d) => {
            const key = localDateKey(d);
            const list = allDayByDay.get(key) ?? [];
            return (
              <div
                key={key}
                data-cal-day={key}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => dropOnDay(e, d, false)}
                className="min-h-[2.75rem] space-y-1 border-l border-zinc-100 p-1 first:border-l-0 dark:border-zinc-800"
              >
                {list.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(CALENDAR_DND_TYPE, item.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onOpenItem(item)}
                    className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium ${eventTone(item)}`}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-1 max-h-[36rem] overflow-auto overscroll-contain"
      >
        <div
          ref={bodyRef}
          className="relative grid select-none"
          style={{
            gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
            height: gridHeight,
          }}
        >
          <div className="relative">
            {Array.from({ length: GRID_HOURS }, (_, h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-zinc-400"
                style={{ top: h * PX_PER_HOUR }}
              >
                {h === 0 ? "" : hourLabel(h)}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const key = localDateKey(d);
            const laid = layouts.get(key) ?? [];
            const isToday = sameDay(d, now);
            return (
              <div
                key={key}
                data-cal-day={key}
                className="relative border-l border-zinc-100 dark:border-zinc-800"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest("[data-cal-event]")) return;
                  e.preventDefault();
                  moved.current = false;
                  const mins = minsFromPoint(e.clientY);
                  bindDrag({
                    mode: "create",
                    dayKey: key,
                    anchorMin: mins,
                    endMin: mins + DEFAULT_DURATION_MIN,
                  });
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => dropOnDay(e, d, true, e.clientY)}
              >
                {Array.from({ length: GRID_HOURS }, (_, h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute left-0 right-0 border-t border-zinc-100 dark:border-zinc-800/80"
                    style={{ top: h * PX_PER_HOUR }}
                  />
                ))}
                {isToday ? (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500"
                    style={{ top: minutesToY(nowMin) }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                ) : null}
                {laid.map((block) => {
                  const draggingThis =
                    drag &&
                    (drag.mode === "move" || drag.mode === "resize") &&
                    drag.itemId === block.item.id;
                  const startMin =
                    draggingThis && drag.mode === "move"
                      ? drag.startMin
                      : block.startMin;
                  const endMin =
                    draggingThis && drag.mode === "resize"
                      ? drag.endMin
                      : draggingThis && drag.mode === "move"
                        ? drag.startMin + drag.duration
                        : block.endMin;
                  const dayKey =
                    draggingThis && drag.mode === "move" ? drag.dayKey : key;
                  if (dayKey !== key && draggingThis && drag.mode === "move") {
                    return null;
                  }
                  const width = `calc((100% - 4px) / ${block.cols})`;
                  const left = `calc(${block.col} * ((100% - 4px) / ${block.cols}) + 2px)`;
                  return (
                    <div
                      key={block.item.id}
                      data-cal-event={block.item.id}
                      className={`absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left shadow-sm ${eventTone(block.item)} ${
                        draggingThis
                          ? "pointer-events-none opacity-90 ring-2 ring-white/70"
                          : "cursor-grab"
                      }`}
                      style={{
                        top: minutesToY(startMin),
                        height: Math.max(18, minutesToY(endMin - startMin) - 2),
                        left,
                        width,
                      }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        const handle = (e.target as HTMLElement).dataset.calResize;
                        if (handle) {
                          bindDrag({
                            mode: "resize",
                            itemId: block.item.id,
                            dayKey: key,
                            startMin: block.startMin,
                            endMin: block.endMin,
                          });
                          return;
                        }
                        bindDrag({
                          mode: "move",
                          itemId: block.item.id,
                          dayKey: key,
                          startMin: block.startMin,
                          duration: Math.max(
                            MIN_DURATION_MIN,
                            block.endMin - block.startMin
                          ),
                        });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (moved.current || skipClick.current) {
                          skipClick.current = false;
                          return;
                        }
                        onOpenItem(block.item);
                      }}
                    >
                      <p className="truncate text-[11px] font-semibold leading-tight">
                        {block.item.title}
                      </p>
                      {endMin - startMin >= 40 ? (
                        <p className="truncate text-[10px] opacity-80">
                          {formatTime(block.item.startsAt ?? "")}
                        </p>
                      ) : null}
                      <div
                        data-cal-resize="1"
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                      />
                    </div>
                  );
                })}
                {drag?.mode === "move" && drag.dayKey === key
                  ? (() => {
                      const item = items.find((i) => i.id === drag.itemId);
                      const already = (layouts.get(key) ?? []).some(
                        (b) => b.item.id === drag.itemId
                      );
                      if (!item || already) return null;
                      return (
                        <div
                          className={`pointer-events-none absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 ${eventTone(item)}`}
                          style={{
                            top: minutesToY(drag.startMin),
                            height: Math.max(18, minutesToY(drag.duration) - 2),
                            left: 2,
                            right: 2,
                          }}
                        >
                          <p className="truncate text-[11px] font-semibold">
                            {item.title}
                          </p>
                        </div>
                      );
                    })()
                  : null}
                {drag?.mode === "create" && drag.dayKey === key ? (
                  <div
                    className="pointer-events-none absolute left-1 right-1 z-10 rounded-md bg-sky-400/40 ring-1 ring-sky-500"
                    style={{
                      top: minutesToY(Math.min(drag.anchorMin, drag.endMin)),
                      height: Math.max(
                        18,
                        minutesToY(
                          Math.max(
                            MIN_DURATION_MIN,
                            Math.abs(drag.endMin - drag.anchorMin)
                          )
                        )
                      ),
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
