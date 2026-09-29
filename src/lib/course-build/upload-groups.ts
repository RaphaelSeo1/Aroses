/**
 * The upload screen's arrangement of sources into materials. Every source
 * starts as its own material; a unit with two or more sources is a combined
 * material built as one build, its sources in the order shown.
 */

export type AppSourceKind = "note" | "live_session" | "tutor_session";

export type UploadSource =
  | { key: string; type: "file"; name: string }
  | { key: string; type: "text"; label: string; text: string }
  | { key: string; type: "url"; url: string }
  | { key: string; type: "app"; kind: AppSourceKind; id: string; label: string };

export type UploadUnit = {
  id: string;
  keys: string[];
  /** The student's name for a combined material; null until they type one. */
  name: string | null;
};

export type BuildSourcePayload =
  | { type: "file"; storagePath: string; name: string }
  | { type: "text"; label: string; text: string }
  | { type: "url"; url: string }
  | { type: "app"; kind: AppSourceKind; id: string };

export type BuildRequest = {
  /** Null for a single source: the planner names it from its content. */
  title: string | null;
  keys: string[];
  sources: BuildSourcePayload[];
};

export const isGroup = (unit: UploadUnit) => unit.keys.length > 1;

export function sourceName(s: UploadSource): string {
  if (s.type === "file") return s.name.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim() || s.name;
  if (s.type === "text") return s.label;
  if (s.type === "app") return s.label;
  try {
    return new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    return s.url;
  }
}

/** A combined material's name before the student renames it: its first source's. */
export function defaultUnitName(unit: UploadUnit, byKey: ReadonlyMap<string, UploadSource>): string {
  const first = unit.keys[0] ? byKey.get(unit.keys[0]) : undefined;
  return first ? sourceName(first) : "";
}

export function unitTitle(unit: UploadUnit, byKey: ReadonlyMap<string, UploadSource>): string {
  return unit.name?.replace(/\s+/g, " ").trim() || defaultUnitName(unit, byKey);
}

function freshId(units: UploadUnit[], base: string): string {
  const taken = new Set(units.map((u) => u.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}~${n}`)) n++;
  return `${base}~${n}`;
}

/** Drops emptied units and forgets the name of a unit that is back to one source. */
function tidy(units: UploadUnit[]): UploadUnit[] {
  return units.filter((u) => u.keys.length > 0).map((u) => (u.keys.length === 1 && u.name !== null ? { ...u, name: null } : u));
}

export function unitOf(units: UploadUnit[], key: string): UploadUnit | undefined {
  return units.find((u) => u.keys.includes(key));
}

/** New sources, each its own material, after the existing ones. */
export function addSingles(units: UploadUnit[], keys: string[]): UploadUnit[] {
  const out = [...units];
  for (const key of keys) {
    if (unitOf(out, key)) continue;
    out.push({ id: freshId(out, key), keys: [key], name: null });
  }
  return out;
}

export function removeSource(units: UploadUnit[], key: string): UploadUnit[] {
  return tidy(units.map((u) => (u.keys.includes(key) ? { ...u, keys: u.keys.filter((k) => k !== key) } : u)));
}

/**
 * Moves `key` into unit `targetId` at `index` (counted without `key`), e.g.
 * dragging a file into a group or reordering it inside its own group.
 */
export function moveSource(units: UploadUnit[], key: string, targetId: string, index: number): UploadUnit[] {
  const target = units.find((u) => u.id === targetId);
  if (!target || !unitOf(units, key)) return units;
  const rest = target.keys.filter((k) => k !== key);
  const at = Math.max(0, Math.min(rest.length, Math.round(index)));
  const keys = [...rest.slice(0, at), key, ...rest.slice(at)];
  if (keys.join("\n") === target.keys.join("\n")) return units;
  return tidy(
    units.map((u) => {
      if (u.id === targetId) return { ...u, keys };
      return u.keys.includes(key) ? { ...u, keys: u.keys.filter((k) => k !== key) } : u;
    })
  );
}

/** Drops `key` onto the source `targetKey`: it joins that source's material, before or after it. */
export function combineWith(units: UploadUnit[], key: string, targetKey: string, place: "before" | "after" = "after"): UploadUnit[] {
  if (key === targetKey) return units;
  const target = unitOf(units, targetKey);
  if (!target) return units;
  const rest = target.keys.filter((k) => k !== key);
  const at = rest.indexOf(targetKey) + (place === "after" ? 1 : 0);
  return moveSource(units, key, target.id, at);
}

/** Takes `key` out of its combined material; it becomes its own, right after the one it left. */
export function separateSource(units: UploadUnit[], key: string): UploadUnit[] {
  const from = unitOf(units, key);
  if (!from || !isGroup(from)) return units;
  const out: UploadUnit[] = [];
  for (const u of units) {
    if (u !== from) {
      out.push(u);
      continue;
    }
    out.push({ ...u, keys: u.keys.filter((k) => k !== key) });
    out.push({ id: freshId(units, key), keys: [key], name: null });
  }
  return tidy(out);
}

/** Splits a combined material back into one material per source. */
export function ungroup(units: UploadUnit[], unitId: string): UploadUnit[] {
  const out: UploadUnit[] = [];
  for (const u of units) {
    if (u.id !== unitId || !isGroup(u)) {
      out.push(u);
      continue;
    }
    const [first, ...rest] = u.keys;
    out.push({ id: u.id, keys: [first!], name: null });
    for (const k of rest) out.push({ id: freshId([...units, ...out], k), keys: [k], name: null });
  }
  return out;
}

/** Moves a source one place up (-1) or down (+1) within its combined material. */
export function nudgeSource(units: UploadUnit[], key: string, delta: -1 | 1): UploadUnit[] {
  const u = unitOf(units, key);
  if (!u) return units;
  const i = u.keys.indexOf(key);
  const j = i + delta;
  if (j < 0 || j >= u.keys.length) return units;
  return moveSource(units, key, u.id, j);
}

export function renameUnit(units: UploadUnit[], unitId: string, name: string): UploadUnit[] {
  return units.map((u) => (u.id === unitId && isGroup(u) ? { ...u, name } : u));
}

/**
 * One build per unit, in screen order. Files must already be uploaded;
 * `storagePaths` maps a file's key to its object path.
 */
export function buildRequests(
  units: UploadUnit[],
  byKey: ReadonlyMap<string, UploadSource>,
  storagePaths: ReadonlyMap<string, string>
): BuildRequest[] {
  return units
    .filter((u) => u.keys.length > 0)
    .map((u) => ({
      title: isGroup(u) ? unitTitle(u, byKey) : null,
      keys: [...u.keys],
      sources: u.keys.map((key): BuildSourcePayload => {
        const s = byKey.get(key);
        if (!s) throw new Error(`unknown source ${key}`);
        if (s.type === "file") {
          const storagePath = storagePaths.get(key);
          if (!storagePath) throw new Error(`${s.name} was not uploaded`);
          return { type: "file", storagePath, name: s.name };
        }
        if (s.type === "text") return { type: "text", label: s.label, text: s.text };
        if (s.type === "url") return { type: "url", url: s.url };
        return { type: "app", kind: s.kind, id: s.id };
      }),
    }));
}

/** A source's page count: a number, "counting" while it is read, or null when only the build can count it. */
export type PageCount = number | "counting" | null;

export type UnitPages = {
  /** Pages counted so far. */
  pages: number;
  counting: boolean;
  /** Some sources (links, recordings, app notes) are only counted by the build. */
  uncounted: boolean;
};

export function unitPages(unit: UploadUnit, counts: Readonly<Record<string, PageCount | undefined>>): UnitPages {
  let pages = 0;
  let counting = false;
  let uncounted = false;
  for (const k of unit.keys) {
    const c = counts[k];
    if (typeof c === "number") pages += c;
    else if (c === "counting") counting = true;
    else uncounted = true;
  }
  return { pages, counting, uncounted };
}
