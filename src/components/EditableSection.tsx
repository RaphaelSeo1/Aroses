"use client";

/**
 * Card shell (similar to Key terms styling): hover reveals Edit; editing shows Cancel in the header.
 */
export function EditableSection({
  label,
  view,
  edit,
  isEditing,
  onEdit,
  onCancel,
}: {
  label: string;
  view: React.ReactNode;
  edit: React.ReactNode;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="group relative rounded-2xl border border-zinc-200/90 bg-zinc-50/40 shadow-sm transition-colors hover:border-brand-border hover:bg-white/90 dark:border-zinc-800 dark:bg-zinc-950/35 dark:hover:border-brand-border/50 dark:hover:bg-zinc-950/70">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100/90 px-4 py-2.5 dark:border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        {!isEditing ? (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-semibold text-brand shadow-sm ring-1 ring-brand-border transition-opacity hover:bg-brand-blush hover:text-brand dark:bg-zinc-900 dark:text-brand-soft dark:ring-brand-border/50 dark:hover:bg-brand-blush/10 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          >
            Edit
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        )}
      </div>
      <div className="px-4 py-4">{isEditing ? edit : view}</div>
    </div>
  );
}
