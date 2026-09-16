"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import {
  pickerChildLabel,
  pickerParentLabel,
  type ReviewPickerChild,
  type ReviewPickerGroup,
} from "@/lib/review-picker";

export function ReviewPickerList({
  groups,
  selectedIds,
  onToggleLeaf,
  onToggleGroup,
  showModulePills = true,
  maxHeightClass = "",
}: {
  groups: ReviewPickerGroup[];
  selectedIds: Set<string>;
  onToggleLeaf: (id: string) => void;
  onToggleGroup: (group: ReviewPickerGroup) => void;
  showModulePills?: boolean;
  maxHeightClass?: string;
}) {
  const t = useT();
  // Courses start collapsed; user expands a row to see nested notes/focus items.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const fallbacks = {
    focusQuestions: t.review.focusQuestions,
    courseFallback: t.review.untitledCourse,
    courseContent: t.review.courseContent,
  };

  return (
    <ul
      className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${maxHeightClass}`}
    >
      {groups.length === 0 ? (
        <li className="px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
          {t.review.noCoursesYet}
        </li>
      ) : (
        groups.map((group, idx) => {
          const isLast = idx === groups.length - 1;
          const selectedCount = group.leafIds.filter((id) =>
            selectedIds.has(id)
          ).length;
          const allOn =
            group.leafIds.length > 0 && selectedCount === group.leafIds.length;
          const someOn = selectedCount > 0 && !allOn;
          const caughtUp = group.total === 0;
          const hasChildren = group.children.length > 0;
          const open = hasChildren && expanded.has(group.id);
          const parentName = pickerParentLabel(group, fallbacks);

          return (
            <li
              key={group.id}
              className={isLast ? "" : "border-b border-zinc-100 dark:border-zinc-900"}
            >
              <div
                className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
                  caughtUp ? "bg-zinc-50/50 dark:bg-zinc-900/30" : ""
                }`}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={parentName}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                  >
                    <Chevron open={open} />
                  </button>
                ) : (
                  <span className="w-6 shrink-0" />
                )}
                <ParentCheckbox
                  checked={allOn}
                  indeterminate={someOn}
                  onChange={() => onToggleGroup(group)}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      caughtUp
                        ? "text-zinc-500 dark:text-zinc-500"
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {parentName}
                  </p>
                  {hasChildren ? (
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-500">
                      {group.children
                        .filter((c) => c.kind === "note")
                        .map((c) => c.fileName)
                        .slice(0, 3)
                        .join(" · ")}
                      {group.children.filter((c) => c.kind === "note").length >
                      3
                        ? "…"
                        : ""}
                    </p>
                  ) : null}
                </div>
                <CountPills
                  module={group.module}
                  personal={group.personal}
                  total={group.total}
                  caughtUp={caughtUp}
                  showModule={showModulePills}
                />
              </div>
              {open ? (
                <ul className="border-t border-zinc-100 bg-zinc-50/60 pb-2 dark:border-zinc-900 dark:bg-zinc-900/40">
                  {group.children.map((child) => (
                    <ChildRow
                      key={child.id}
                      group={group}
                      child={child}
                      checked={selectedIds.has(child.id)}
                      onToggle={() => onToggleLeaf(child.id)}
                      showModulePills={showModulePills}
                      courseContent={fallbacks.courseContent}
                      focusQuestions={fallbacks.focusQuestions}
                    />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })
      )}
    </ul>
  );
}

function ChildRow({
  group,
  child,
  checked,
  onToggle,
  showModulePills,
  courseContent,
  focusQuestions,
}: {
  group: ReviewPickerGroup;
  child: ReviewPickerChild;
  checked: boolean;
  onToggle: () => void;
  showModulePills: boolean;
  courseContent: string;
  focusQuestions: string;
}) {
  return (
    <li className="flex items-center gap-3 py-2 pl-14 pr-4 sm:pr-5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-brand focus:ring-brand"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-800 dark:text-zinc-200">
          {pickerChildLabel(group, child, { courseContent, focusQuestions })}
        </p>
      </div>
      <CountPills
        module={child.module}
        personal={child.personal}
        total={child.total}
        caughtUp={false}
        showModule={showModulePills && child.kind === "module"}
        compact
      />
    </li>
  );
}

function ParentCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      onChange={onChange}
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-brand focus:ring-brand"
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CountPills({
  module,
  personal,
  total,
  caughtUp,
  showModule,
  compact = false,
}: {
  module: number;
  personal: number;
  total: number;
  caughtUp: boolean;
  showModule: boolean;
  compact?: boolean;
}) {
  const t = useT();
  if (caughtUp) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        {t.review.allCaughtUpPill}
      </span>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
      {showModule ? (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
            module > 0
              ? "bg-brand-blush font-medium text-brand-ink dark:bg-brand-blush/15 dark:text-brand-soft"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500"
          }`}
        >
          {t.review.moduleLabel} {module}
        </span>
      ) : personal > 0 ? (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {compact ? `+${personal}` : `+${personal} ${t.review.focusLabel.toLowerCase()}`}
        </span>
      ) : null}
      {showModule ? (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
            personal > 0
              ? "bg-zinc-100 font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500"
          }`}
        >
          {t.review.focusLabel} {personal}
        </span>
      ) : null}
      <span className="ml-1 font-semibold text-zinc-900 dark:text-zinc-100">
        {total}
      </span>
    </div>
  );
}
