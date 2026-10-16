/**
 * HaloForge MCP | Shared helpers for export, compare, copy and document
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { HaloClient } from "../client/halo-client.js";
import { listRecords } from "../tools/resource-factory.js";
import {
  CONFIG_AREAS,
  CONFIG_RESOURCES,
  ConfigArea,
  ConfigResource,
  findConfigResource,
} from "../catalogue/config-resources.js";
import { isPlainObject } from "../safety/merge.js";
import { isSensitiveKey } from "../utils/secrets.js";

export type Obj = Record<string, unknown>;

export const DEFAULT_EXPORT_DIR = "exports";

/** Keys that identify a record on one instance and mean nothing on another. */
export const IDENTITY_KEYS = new Set([
  "id", "guid", "uniqueid", "datecreated", "createdby", "datelastmodified", "lastmodifiedby",
  "last_modified", "date_modified", "modified_date", "created_date", "_etag",
]);

export function exportRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.HALO_EXPORT_DIR || DEFAULT_EXPORT_DIR);
}

/** A path inside the export root. Refuses anything that escapes it. */
export function safePath(relativePath: string | undefined, fallback: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = exportRoot(env);
  const target = resolve(root, relativePath && relativePath.trim() ? relativePath : fallback);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Paths must stay inside the export folder (${root}). Set HALO_EXPORT_DIR to change it.`);
  }
  return target;
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .substring(0, 60) || "unnamed"
  );
}

/** The display name of a record, used to match records across instances. */
export function nameOf(record: Obj): string | undefined {
  for (const k of ["name", "summary", "title", "description"]) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Name used as the match key; Lookup values are matched within their lookup. */
export function matchKeyOf(resource: string, record: Obj): string | undefined {
  const name = nameOf(record);
  if (!name) return undefined;
  if (resource.toLowerCase() === "lookup" && record.lookupid !== undefined) return `${record.lookupid}|${name.toLowerCase()}`;
  return name.toLowerCase();
}

export interface Selection {
  areas?: string[];
  resources?: string[];
  includeData?: boolean;
}

/** Resolve areas and resource names to catalogue entries (or bare names for anything else). */
export function selectResources(sel: Selection): ConfigResource[] {
  const out = new Map<string, ConfigResource>();
  const areas = sel.areas?.map((a) => a.toLowerCase());
  if (areas?.length) {
    for (const a of areas) {
      if (a !== "all" && !CONFIG_AREAS.some((c) => c.toLowerCase() === a)) {
        throw new Error(`Unknown area "${a}". Areas: ${CONFIG_AREAS.join(", ")}, or all`);
      }
    }
    for (const r of CONFIG_RESOURCES) {
      if ((areas.includes("all") || areas.includes(r.area.toLowerCase())) && (sel.includeData || !r.data)) out.set(r.resource, r);
    }
  }
  for (const name of sel.resources ?? []) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`"${name}" is not a resource name`);
    const known = findConfigResource(name);
    out.set(known?.resource ?? name, known ?? { resource: name, area: "Other configuration" as ConfigArea, uiPath: "" });
  }
  if (out.size === 0) {
    for (const r of CONFIG_RESOURCES) if (sel.includeData || !r.data) out.set(r.resource, r);
  }
  return [...out.values()];
}

export interface FetchOptions {
  details?: boolean;
  maxItems?: number;
  params?: Obj;
}

/** Every record of a resource, with details when asked. Errors are returned, not thrown. */
export async function fetchRecords(
  client: HaloClient,
  resource: string,
  options: FetchOptions = {}
): Promise<{ records: Obj[]; error?: string; truncated?: boolean }> {
  try {
    const list = await listRecords(client, `/${resource}`, {
      params: { page_size: 100, ...(options.params ?? {}) },
      allPages: true,
      maxItems: options.maxItems ?? 1000,
    });
    let records = list.records.filter(isPlainObject);
    if (options.details) {
      const detailed: Obj[] = [];
      for (const r of records) {
        if (r.id === undefined || r.id === null) {
          detailed.push(r);
          continue;
        }
        try {
          const d = await client.get(`/${resource}`, r.id as number, { includedetails: true });
          detailed.push(isPlainObject(d.data) ? d.data : r);
        } catch {
          detailed.push(r);
        }
      }
      records = detailed;
    }
    return { records, truncated: list.truncated };
  } catch (err) {
    return { records: [], error: (err as Error).message };
  }
}

/**
 * Remove identity keys recursively so records from two instances can be
 * compared. Sensitive values are dropped too, as exports mask them.
 */
export function normalise(value: unknown, ignore: Set<string>, depth = 0): unknown {
  if (depth > 30) return value;
  if (Array.isArray(value)) return value.map((v) => normalise(v, ignore, depth + 1));
  if (isPlainObject(value)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) {
      if (ignore.has(k.toLowerCase()) || isSensitiveKey(k)) continue;
      out[k] = normalise(v, ignore, depth + 1);
    }
    return out;
  }
  return value;
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Read an export folder back: resource name to records. */
export function readExport(dir: string): { manifest?: Obj; resources: Map<string, Obj[]> } {
  const resources = new Map<string, Obj[]>();
  let manifest: Obj | undefined;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch {
    manifest = undefined;
  }
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry);
    if (!statSync(sub).isDirectory()) continue;
    const records: Obj[] = [];
    for (const file of readdirSync(sub).sort()) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(readFileSync(join(sub, file), "utf8"));
      if (isPlainObject(data)) records.push(data);
    }
    resources.set(entry, records);
  }
  if (resources.size === 0 && !manifest) throw new Error(`No export found in ${dir}`);
  return { manifest, resources };
}
