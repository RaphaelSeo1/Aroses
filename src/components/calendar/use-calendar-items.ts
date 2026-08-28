"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalendarItem, CalendarItemInput } from "@/types/calendar";

export function useCalendarItems() {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/calendar");
    const data = (await res.json().catch(() => ({}))) as {
      items?: CalendarItem[];
      error?: string;
    };
    if (!res.ok) {
      setError(data.error || "Could not load calendar.");
      setLoading(false);
      return;
    }
    setItems(Array.isArray(data.items) ? data.items : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(async (input: CalendarItemInput) => {
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as {
      item?: CalendarItem;
      error?: string;
    };
    if (!res.ok || !data.item) {
      throw new Error(data.error || "Could not add that.");
    }
    setItems((prev) => [...prev, data.item!]);
    return data.item;
  }, []);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/calendar/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        item?: CalendarItem;
        error?: string;
      };
      if (!res.ok || !data.item) {
        throw new Error(data.error || "Could not update that.");
      }
      setItems((prev) => prev.map((i) => (i.id === id ? data.item! : i)));
      return data.item;
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/calendar/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "Could not remove that.");
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return {
    items,
    setItems,
    loading,
    error,
    reload,
    add,
    patch,
    remove,
  };
}
