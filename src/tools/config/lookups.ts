/**
 * HaloForge MCP | Name lookups shared by the higher level tools
 *
 * Resolves field and field group IDs to names (and back) so layouts can be
 * read and changed by name.
 */

import { HaloClient } from "../../client/halo-client.js";
import { listRecords } from "../resource-factory.js";

export interface NamedItem {
  id: number;
  name: string;
  label?: string;
}

type Obj = Record<string, unknown>;

function toNamed(r: unknown): NamedItem | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Obj;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return undefined;
  const name = String(o.name ?? o.fieldname ?? o.label ?? o.id);
  const label = o.label ?? o.display_name ?? o.caption;
  return { id, name, ...(label !== undefined && label !== null && String(label) !== name ? { label: String(label) } : {}) };
}

/** id to item, for every record of a resource. */
export async function loadNames(client: HaloClient, apiPath: string, params: Obj = {}): Promise<Map<number, NamedItem>> {
  const result = await listRecords(client, apiPath, { params: { page_size: 100, ...params }, allPages: true, maxItems: 20_000 });
  const map = new Map<number, NamedItem>();
  for (const r of result.records) {
    const item = toNamed(r);
    if (item) map.set(item.id, item);
  }
  return map;
}

/** Resolve a name (or label) to an ID. Errors on no match or more than one. */
export function resolveName(map: Map<number, NamedItem>, name: string, kind: string): number {
  const wanted = name.trim().toLowerCase();
  const exact = [...map.values()].filter((i) => i.name.toLowerCase() === wanted);
  const matches = exact.length > 0 ? exact : [...map.values()].filter((i) => i.label?.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) throw new Error(`No ${kind} named "${name}"`);
  throw new Error(`${matches.length} ${kind}s are named "${name}" (IDs ${matches.map((m) => m.id).join(", ")}); use the ID instead`);
}
