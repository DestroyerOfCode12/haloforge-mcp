/**
 * HaloForge MCP | Response shape description
 *
 * Describes the structure of a Halo response (types, keys and counts) without
 * any record values, for diagnosing endpoints with unexpected shapes.
 */

type Obj = Record<string, unknown>;

export function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Field names of a record and the field names of its nested child objects. */
export function describeRecord(record: Obj): { fields: string[]; nested: Record<string, string[]> } {
  const fields = Object.keys(record).sort();
  const nested: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(record)) {
    const children = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    const keys = new Set<string>();
    for (const child of children) {
      if (child && typeof child === "object" && !Array.isArray(child)) for (const k of Object.keys(child)) keys.add(k);
    }
    if (keys.size > 0) nested[key] = [...keys].sort();
  }
  return { fields, nested };
}

/** Top level shape of a response: for objects, each key with its type and array length. */
export function describeResponse(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return { type: "array", length: data.length, item_type: data.length ? typeOf(data[0]) : "unknown" };
  if (data && typeof data === "object") {
    const keys: Record<string, string> = {};
    for (const [k, v] of Object.entries(data as Obj)) keys[k] = Array.isArray(v) ? `array(${v.length})` : typeOf(v);
    return { type: "object", keys };
  }
  return { type: typeOf(data) };
}
