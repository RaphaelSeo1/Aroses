import type {
  WhiteboardAction,
  WhiteboardActionColor,
  WhiteboardState,
} from "@/types/mentored";

/** Course-wide semantic stroke/fill colors for tutor marks. */
export const WHITEBOARD_COLORS: Record<
  WhiteboardActionColor,
  { stroke: string; fill: string; labelBg: string }
> = {
  default: {
    stroke: "rgba(217,70,239,0.9)",
    fill: "rgba(217,70,239,0.15)",
    labelBg: "rgba(24,24,27,0.82)",
  },
  excitatory: {
    stroke: "rgba(34,197,94,0.92)",
    fill: "rgba(34,197,94,0.18)",
    labelBg: "rgba(20,83,45,0.88)",
  },
  inhibitory: {
    stroke: "rgba(239,68,68,0.92)",
    fill: "rgba(239,68,68,0.16)",
    labelBg: "rgba(127,29,29,0.88)",
  },
  highlight: {
    stroke: "rgba(250,204,21,0.95)",
    fill: "rgba(250,204,21,0.22)",
    labelBg: "rgba(113,63,18,0.9)",
  },
};

export const TURN_WB_SENTINEL = "---WB---";

let actionIdSeq = 0;

export function nextWhiteboardActionId(): string {
  actionIdSeq += 1;
  return `wb-${Date.now().toString(36)}-${actionIdSeq}`;
}

export function ensureActionId(action: WhiteboardAction): WhiteboardAction {
  if ("id" in action && action.id) return action;
  return { ...action, id: nextWhiteboardActionId() };
}

export function applyWhiteboardActions(
  state: WhiteboardState,
  incoming: WhiteboardAction[]
): WhiteboardState {
  let actions = [...state.actions];
  let assetId = state.assetId ?? null;
  let tableAnchored = state.tableAnchored ?? false;

  for (const raw of incoming) {
    const action = ensureActionId(raw);
    if (action.type === "clear") {
      actions = [];
      assetId = null;
      tableAnchored = false;
      continue;
    }
    if (action.type === "clear_except") {
      const keep = new Set(action.keepIds);
      actions = actions.filter((a) => "id" in a && a.id && keep.has(a.id));
      continue;
    }
    if (action.type === "show_asset") {
      assetId = action.assetId;
      actions.push(action);
      continue;
    }
    if (action.type === "show_table") {
      tableAnchored = true;
      actions.push(action);
      continue;
    }
    actions.push(action);
  }

  return {
    assetId,
    tableAnchored,
    actions: actions.slice(-24),
    revealedCount: actions.length,
  };
}

/** Progressive reveal: unlock actions whose `cue` appears in narration. */
export function countRevealedForNarration(
  actions: WhiteboardAction[],
  narrationText: string
): number {
  if (actions.length === 0) return 0;
  const narr = narrationText.toLowerCase();
  if (!narr.trim()) {
    // Anchor substrate first when table/show_asset has no cue.
    const firstDrawable = actions.findIndex(
      (a) => a.type === "show_table" || a.type === "show_asset"
    );
    return firstDrawable >= 0 ? 1 : 0;
  }

  let revealed = 0;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const cue =
      "cue" in a && typeof a.cue === "string" ? a.cue.trim().toLowerCase() : "";
    if (!cue) {
      revealed = i + 1;
      continue;
    }
    if (narr.includes(cue)) {
      revealed = i + 1;
    } else {
      break;
    }
  }
  return revealed;
}

export function visibleLiveActions(
  state: WhiteboardState,
  narrationText: string
): {
  actions: WhiteboardAction[];
  revealedCount: number;
  tableAnchored: boolean;
} {
  const explicit = state.revealedCount;
  const fromNarration = countRevealedForNarration(state.actions, narrationText);
  const revealedCount =
    typeof explicit === "number" && explicit > fromNarration
      ? explicit
      : fromNarration;
  return {
    actions: state.actions.slice(0, revealedCount),
    revealedCount,
    tableAnchored:
      state.tableAnchored === true ||
      state.actions.some(
        (a, i) => i < revealedCount && (a.type === "show_table" || a.type === "show_asset")
      ),
  };
}

export function overlayDrawableActions(actions: WhiteboardAction[]): WhiteboardAction[] {
  return actions.filter(
    (a) =>
      a.type === "draw_arrow" ||
      a.type === "add_label" ||
      a.type === "highlight_bbox"
  );
}
