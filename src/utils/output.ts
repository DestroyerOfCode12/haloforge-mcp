/**
 * HaloForge MCP | Output control
 *
 * Field projection, list extraction and size control. Output is never cut off
 * silently: when a result would exceed the size limit, a compact summary is
 * returned instead with an explicit notice saying what was left out and how
 * to get the rest.
 */

export const DEFAULT_MAX_OUTPUT_CHARS = 80_000;

export function maxOutputChars(): number {
  const v = parseInt(process.env.HALO_MAX_OUTPUT_CHARS || "", 10);
  return Number.isFinite(v) && v > 1000 ? v : DEFAULT_MAX_OUTPUT_CHARS;
}

type Obj = Record<string, unknown>;

function getPath(obj: Obj, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Obj)[part];
  }
  return cur;
}

function setPath(obj: Obj, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part] as Obj;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Keep only the chosen fields (dot paths allowed). Fields that do not exist are left out. */
export function projectFields<T>(value: T, fields?: string[]): T {
  if (!fields || fields.length === 0) return value;
  if (Array.isArray(value)) return value.map((v) => projectFields(v, fields)) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const out: Obj = {};
  for (const f of fields) {
    const v = getPath(value as Obj, f);
    if (v !== undefined) setPath(out, f, v);
  }
  return out as T;
}

/**
 * Pull the record array out of a Halo list response. Halo returns either a
 * bare array, { record_count, records }, or { record_count, <name>: [...] }
 * (for example tickets, users, clients).
 */
export function extractRecords(data: unknown): { records: unknown[]; total?: number; bare: boolean; key?: string } {
  if (Array.isArray(data)) return { records: data, total: data.length, bare: true };
  if (data && typeof data === "object") {
    const obj = data as Obj;
    const total = typeof obj.record_count === "number" ? obj.record_count : undefined;
    if (Array.isArray(obj.records)) return { records: obj.records, total, bare: false, key: "records" };
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "columns" && key !== "columns_list" && Array.isArray(value)) return { records: value, total, bare: false, key };
    }
    return { records: [], total, bare: false };
  }
  return { records: [], bare: false };
}

function fieldNames(records: unknown[]): string[] {
  const names = new Set<string>();
  for (const r of records.slice(0, 200)) {
    if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) names.add(k);
  }
  return [...names];
}

const IDENTITY_FIELDS = ["id", "name", "summary", "title", "description", "guid", "inactive", "type", "sequence", "seq"];

function identity(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const out: Obj = {};
  for (const k of IDENTITY_FIELDS) {
    const v = (record as Obj)[k];
    if (v !== undefined && (typeof v !== "string" || v.length <= 200)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : { fields: Object.keys(record as Obj).slice(0, 10) };
}

export interface ListEnvelope {
  pagination: Record<string, unknown>;
  records: unknown[];
  [key: string]: unknown;
}

/**
 * Serialise a list result, falling back to a compact summary when it would
 * exceed the size limit.
 */
export function renderList(envelope: ListEnvelope, limit = maxOutputChars()): string {
  const full = JSON.stringify(envelope, null, 2);
  if (full.length <= limit) return full;

  const records = envelope.records;
  const sample: unknown[] = [];
  let size = 0;
  for (const r of records) {
    const s = JSON.stringify(identity(r));
    if (size + s.length > limit / 2) break;
    sample.push(identity(r));
    size += s.length;
  }
  const summary = {
    ...envelope,
    records: sample,
    compact_summary: true,
    notice:
      `Output would be ${full.length} characters, over the ${limit} character limit, so a compact summary is shown. ` +
      `Records below show identity fields only (${sample.length} of ${records.length} returned). ` +
      "To see more, pass fields: [...] to choose fields, lower page_size or max_items, or page with page_no.",
    available_fields: fieldNames(records),
  };
  return JSON.stringify(summary, null, 2);
}

/** Serialise a single object, summarising it when it would exceed the size limit. */
export function renderObject(data: unknown, limit = maxOutputChars()): string {
  const full = JSON.stringify(data, null, 2);
  if (full === undefined) return "null";
  if (full.length <= limit) return full;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys: Obj = {};
    const small: Obj = {};
    for (const [k, v] of Object.entries(data as Obj)) {
      const s = JSON.stringify(v) ?? "";
      if (Array.isArray(v)) keys[k] = `array of ${v.length} (${s.length} chars)`;
      else if (v && typeof v === "object") keys[k] = `object (${s.length} chars)`;
      else if (s.length > 300) keys[k] = `${typeof v} (${s.length} chars)`;
      else small[k] = v;
    }
    return JSON.stringify(
      {
        compact_summary: true,
        notice:
          `Output would be ${full.length} characters, over the ${limit} character limit. ` +
          "Simple values are shown; large values are described. Pass fields: [...] to get specific fields in full.",
        values: small,
        large_fields: keys,
      },
      null,
      2
    );
  }
  if (Array.isArray(data)) return renderList({ pagination: { total_count: data.length }, records: data }, limit);
  return JSON.stringify(
    { compact_summary: true, notice: `Text output of ${full.length} characters exceeds the ${limit} character limit.`, start: full.substring(0, limit / 2) },
    null,
    2
  );
}
