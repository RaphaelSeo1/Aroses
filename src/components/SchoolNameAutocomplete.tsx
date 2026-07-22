"use client";

import { useMemo, useState } from "react";
import { filterSchoolSuggestions } from "@/lib/school-suggestions";

/**
 * Shared school name field with curated autocomplete (onboarding / settings /
 * course school tag).
 */
export function SchoolNameAutocomplete({
  value,
  onChange,
  placeholder,
  id,
  maxLength = 200,
  className,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  id?: string;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(
    () => filterSchoolSuggestions(value, 10),
    [value]
  );

  return (
    <div className="relative w-full">
      <input
        id={id}
        type="text"
        autoComplete="organization"
        maxLength={maxLength}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder={placeholder}
        className={className}
      />
      {open && suggestions.length > 0 ? (
        <ul
          className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          role="listbox"
        >
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-zinc-800 hover:bg-brand-blush dark:text-zinc-100 dark:hover:bg-zinc-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
