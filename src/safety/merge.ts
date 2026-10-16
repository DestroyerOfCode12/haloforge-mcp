/**
 * HaloForge MCP | Safe merge helper for nested arrays
 *
 * Halo's upsert replaces nested arrays wholesale: sending a ticket type with
 * one entry in fields[] removes every other field from the layout. The merge
 * helper reads the current record, merges the requested change into each
 * nested array item by a match key, and returns a payload that carries the
 * complete arrays so nothing is lost.
 *
 * Patch array items:
 *   { fieldid: 12, seq: 3 }              update the item whose fieldid is 12
 *   { fieldid: 99, groupid: 2 }          append (no item with fieldid 99)
 *   { fieldid: 12, _remove: true }       take the item out of the array
 */

export const REMOVE_FLAG = "_remove";

/** Array key to candidate match keys, in order of preference. */
export type MergeRules = Record<string, string[]>;

export const DEFAULT_MATCH_KEYS = ["id"];

export interface MergeOptions {
  /** Array keys to replace as given instead of merging */
  replaceArrays?: string[];
  /** Return the full current object with the change applied, not just the changed keys */
  fullObject?: boolean;
}

export interface MergeResult {
  payload: Record<string, unknown>;
  warnings: string[];
}

type Obj = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

function sameKey(a: unknown, b: unknown): boolean {
  return present(a) && present(b) && String(a) === String(b);
}

/** The first candidate key the item carries, if any. */
export function matchKeyFor(item: Obj, candidates: string[]): string | undefined {
  return candidates.find((k) => present(item[k]));
}

function stripFlags(item: Obj): Obj {
  const { [REMOVE_FLAG]: _removed, ...rest } = item;
  void _removed;
  return rest;
}

/**
 * Merge patch items into the current array. Items keep their current order;
 * new items are appended in patch order.
 */
export function mergeArray(
  current: unknown[],
  patch: unknown[],
  candidates: string[],
  label: string,
  warnings: string[]
): unknown[] {
  const result: unknown[] = [...current];
  for (const raw of patch) {
    if (!isPlainObject(raw)) {
      result.push(raw);
      continue;
    }
    const key = matchKeyFor(raw, candidates);
    const index = key === undefined ? -1 : result.findIndex((c) => isPlainObject(c) && sameKey(c[key], raw[key]));
    if (raw[REMOVE_FLAG] === true) {
      if (index >= 0) result.splice(index, 1);
      else warnings.push(`${label}: nothing to remove for ${key ?? "item"}=${key ? String(raw[key]) : "(no match key)"}`);
      continue;
    }
    if (index >= 0) {
      result[index] = { ...(result[index] as Obj), ...stripFlags(raw) };
    } else {
      result.push(stripFlags(raw));
    }
  }
  return result;
}

/**
 * Merge a patch into the current record. Top level scalar values in the patch
 * replace current values. Arrays of objects are merged item by item using the
 * rules (or the item id when no rule exists). Arrays of plain values, and arrays
 * listed in replaceArrays, are replaced as given.
 */
export function mergeRecord(current: Obj, patch: Obj, rules: MergeRules = {}, options: MergeOptions = {}): MergeResult {
  const warnings: string[] = [];
  const replace = new Set(options.replaceArrays ?? []);
  const merged: Obj = {};

  for (const [key, value] of Object.entries(patch)) {
    const existing = current[key];
    if (Array.isArray(value) && Array.isArray(existing) && !replace.has(key)) {
      const candidates = rules[key] ?? DEFAULT_MATCH_KEYS;
      const objectItems = value.filter(isPlainObject);
      const anyMatchable = objectItems.some((item) => matchKeyFor(item, candidates) !== undefined);
      if (objectItems.length > 0 && !rules[key] && !anyMatchable) {
        warnings.push(`${key}: no match key (${candidates.join(", ")}) in the change, so the array is replaced as given`);
        merged[key] = value.map((v) => (isPlainObject(v) ? stripFlags(v) : v));
      } else if (objectItems.length === 0 && value.length > 0) {
        merged[key] = value;
      } else {
        merged[key] = mergeArray(existing, value, candidates, key, warnings);
      }
    } else if (Array.isArray(value)) {
      merged[key] = value.map((v) => (isPlainObject(v) ? stripFlags(v) : v));
    } else {
      merged[key] = value;
    }
  }

  const payload = options.fullObject ? { ...current, ...merged } : merged;
  if (present(current.id) && !present(payload.id)) payload.id = current.id;
  return { payload, warnings };
}
