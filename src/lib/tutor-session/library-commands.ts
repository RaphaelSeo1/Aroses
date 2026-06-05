export type SessionLibraryCommand =
  | { type: "select_all" }
  | { type: "clear" }
  | { type: "delete" }
  | { type: "combine" }
  | { type: "exit_manage" }
  | { type: "unknown" };

/** Lightweight intent parsing for the sessions library command bar. */
export function parseSessionLibraryCommand(raw: string): SessionLibraryCommand {
  const t = raw.trim().toLowerCase();
  if (!t) return { type: "unknown" };

  if (
    /\b(select all|all sessions|select everything|check all)\b/.test(t)
  ) {
    return { type: "select_all" };
  }
  if (/\b(clear|deselect|unselect|none)\b/.test(t)) {
    return { type: "clear" };
  }
  if (/\b(done|exit|cancel manage|stop selecting)\b/.test(t)) {
    return { type: "exit_manage" };
  }
  if (/\b(delete|remove|trash|discard)\b/.test(t)) {
    return { type: "delete" };
  }
  if (
    /\b(combine|merge|group|collective|compile|unify)\b/.test(t) &&
    /\b(note|notes|recap|recaps|session|sessions)\b/.test(t)
  ) {
    return { type: "combine" };
  }
  if (/\b(combine|merge)\b/.test(t)) {
    return { type: "combine" };
  }

  return { type: "unknown" };
}

export const SESSION_LIBRARY_COMMAND_HINTS = [
  "delete selected",
  "combine notes",
  "select all",
  "clear selection",
] as const;
