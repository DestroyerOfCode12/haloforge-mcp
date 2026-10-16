/**
 * HaloForge MCP | Field by field diff
 *
 * Produces a before and after list for a proposed write. Nested arrays of
 * objects are compared item by item using the same match keys as the merge
 * helper, so a change to one ticket type field shows as one changed path
 * rather than the whole array.
 */

import { DEFAULT_MATCH_KEYS, MergeRules, isPlainObject, matchKeyFor } from "./merge.js";

export const NOT_SET = "(not set)";

/** Keys tried for matching array items when the rules give none that fit. */
const FALLBACK_KEYS = ["fieldid", "field_id", "guid", "name"];

export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

type Obj = Record<string, unknown>;

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null;
}

/** Equality that treats null and undefined alike and 1 and "1" alike. */
export function looselyEqual(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  if (typeof a !== "object" && typeof b !== "object") return String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => looselyEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!looselyEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function show(v: unknown): unknown {
  return v === undefined ? NOT_SET : v;
}

function diffArrays(before: unknown[], after: unknown[], candidates: string[], path: string, out: Change[]): void {
  const afterObjs = after.filter(isPlainObject);
  const beforeObjs = before.filter(isPlainObject);
  const keys = [...candidates, ...FALLBACK_KEYS.filter((k) => !candidates.includes(k))];
  const key =
    afterObjs.length === after.length && beforeObjs.length === before.length
      ? keys.find((k) => afterObjs.every((i) => matchKeyFor(i, [k])) && beforeObjs.every((i) => matchKeyFor(i, [k])))
      : undefined;

  if (!key) {
    if (!looselyEqual(before, after)) out.push({ path, before, after });
    return;
  }

  const seen = new Set<string>();
  for (const item of afterObjs) {
    const id = String(item[key]);
    seen.add(id);
    const match = beforeObjs.find((b) => String(b[key]) === id);
    const itemPath = `${path}[${key}=${id}]`;
    if (!match) out.push({ path: itemPath, before: NOT_SET, after: item });
    else diffObjects(match, item, {}, itemPath, out, false);
  }
  for (const item of beforeObjs) {
    const id = String(item[key]);
    if (!seen.has(id)) out.push({ path: `${path}[${key}=${id}]`, before: item, after: NOT_SET });
  }
}

function diffObjects(before: Obj, after: Obj, rules: MergeRules, path: string, out: Change[], afterKeysOnly: boolean): void {
  const keys = afterKeysOnly ? Object.keys(after) : [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    const p = path ? `${path}.${key}` : key;
    diffValue(before[key], after[key], rules[key] ?? DEFAULT_MATCH_KEYS, p, out);
  }
}

function diffValue(before: unknown, after: unknown, candidates: string[], path: string, out: Change[]): void {
  if (looselyEqual(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) return diffArrays(before, after, candidates, path, out);
  if (isPlainObject(before) && isPlainObject(after)) return diffObjects(before, after, {}, path, out, false);
  out.push({ path, before: show(before), after: show(after) });
}

/**
 * Diff a proposed payload against the current record. Only keys present in
 * the payload are compared, because Halo leaves absent keys unchanged.
 * Pass current = undefined for a create.
 */
export function diffRecord(current: Obj | undefined, proposed: Obj, rules: MergeRules = {}): Change[] {
  const out: Change[] = [];
  if (!current) {
    for (const [key, value] of Object.entries(proposed)) out.push({ path: key, before: NOT_SET, after: value });
    return out;
  }
  diffObjects(current, proposed, rules, "", out, true);
  return out;
}

/** Short summary for the audit log: changed paths only, never values. */
export function summariseChanges(changes: Change[], max = 50): { count: number; paths: string[]; more?: number } {
  const paths = changes.map((c) => c.path);
  return paths.length > max ? { count: paths.length, paths: paths.slice(0, max), more: paths.length - max } : { count: paths.length, paths };
}
