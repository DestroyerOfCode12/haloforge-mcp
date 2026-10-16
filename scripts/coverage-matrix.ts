/**
 * HaloForge MCP | Coverage matrix generator
 *
 * Writes docs/coverage-matrix.md from the configuration resource catalogue.
 *
 *   npx tsx scripts/coverage-matrix.ts           static columns only
 *   npx tsx scripts/coverage-matrix.ts --live    also query an instance (read only)
 *
 * Live mode reads the instance named by --instance (default: trial) from
 * HALO_<NAME>_BASE_URL, HALO_<NAME>_CLIENT_ID and HALO_<NAME>_CLIENT_SECRET,
 * falling back to HALO_BASE_URL, HALO_CLIENT_ID and HALO_CLIENT_SECRET.
 *
 * Live mode only ever sends GET requests (plus the token request). It records
 * field names, nested child object field names and record counts. It never
 * writes record values to the output.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CONFIG_AREAS,
  CONFIG_RESOURCES,
  ORIGINAL_REPO_RESOURCES,
  ConfigResource,
} from "../src/catalogue/config-resources.js";
import { configureProxy } from "../src/utils/proxy.js";
import { allToolDefinitions } from "../src/tools/registry.js";

/** Tool prefix per API resource, from the tool definitions. */
function toolPrefixes(): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of allToolDefinitions()) {
    const m = def.name.match(/^(halo_.+)_(list|get)$/);
    if (!m) continue;
    for (const r of def.resources ?? []) {
      if (/^[A-Z]/.test(r) && !map.has(r.toLowerCase())) map.set(r.toLowerCase(), `${m[1]}_*`);
    }
  }
  return map;
}

interface Methods {
  list: boolean;
  get: boolean;
  post: boolean;
  delete: boolean;
}

interface LiveResult {
  methods?: Methods;
  records?: number | string;
  fields?: string[];
  nested?: Record<string, string[]>;
  error?: string;
}

const args = process.argv.slice(2);
const live = args.includes("--live");
const instanceArg = args.find((a) => a.startsWith("--instance="))?.split("=")[1] ?? "trial";
const outPath = resolve(args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "docs/coverage-matrix.md");

function env(name: string): string | undefined {
  const key = `HALO_${instanceArg.toUpperCase()}_${name}`;
  return process.env[key] || process.env[`HALO_${name}`];
}

async function getToken(base: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env("CLIENT_ID") ?? "",
    client_secret: env("CLIENT_SECRET") ?? "",
    scope: env("SCOPE") ?? "all",
  });
  const res = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token request failed with HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

function methodsFromSpec(spec: { paths?: Record<string, Record<string, unknown>> }): Map<string, Methods> {
  const map = new Map<string, Methods>();
  for (const [rawPath, ops] of Object.entries(spec.paths ?? {})) {
    const path = rawPath.replace(/^\/api/i, "");
    const m = path.match(/^\/([A-Za-z0-9_]+)(\/\{[^}]+\})?$/);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const isItem = Boolean(m[2]);
    const entry = map.get(name) ?? { list: false, get: false, post: false, delete: false };
    const verbs = Object.keys(ops).map((v) => v.toLowerCase());
    if (verbs.includes("get")) {
      if (isItem) entry.get = true;
      else entry.list = true;
    }
    if (verbs.includes("post") && !isItem) entry.post = true;
    if (verbs.includes("delete") && isItem) entry.delete = true;
    map.set(name, entry);
  }
  return map;
}

function extractRecords(data: unknown): { records: unknown[]; total?: number } {
  if (Array.isArray(data)) return { records: data, total: data.length };
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const total = typeof obj.record_count === "number" ? obj.record_count : undefined;
    if (Array.isArray(obj.records)) return { records: obj.records, total };
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "columns" && Array.isArray(value)) return { records: value, total };
    }
  }
  return { records: [] };
}

function describeShape(record: Record<string, unknown>): { fields: string[]; nested: Record<string, string[]> } {
  const fields = Object.keys(record).sort();
  const nested: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(record)) {
    const children = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    const keys = new Set<string>();
    for (const child of children) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        for (const k of Object.keys(child)) keys.add(k);
      }
    }
    if (keys.size > 0) nested[key] = [...keys].sort();
  }
  return { fields, nested };
}

async function probe(base: string, token: string, res: ConfigResource, methods?: Methods): Promise<LiveResult> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const out: LiveResult = { methods };
  try {
    const listUrl = new URL(`${base}/api/${res.resource}`);
    listUrl.searchParams.set("pageinate", "true");
    listUrl.searchParams.set("page_size", "3");
    listUrl.searchParams.set("page_no", "1");
    listUrl.searchParams.set("count", "3");
    const listRes = await fetch(listUrl, { headers });
    if (!listRes.ok) {
      out.error = `list HTTP ${listRes.status}`;
      return out;
    }
    const { records, total } = extractRecords(await listRes.json());
    out.records = total ?? (records.length >= 3 ? "3 or more" : records.length);
    const first = records[0] as Record<string, unknown> | undefined;
    const id = first && (first.id ?? first.Id);
    if (id === undefined || id === null) {
      if (first) Object.assign(out, describeShape(first));
      return out;
    }
    const getRes = await fetch(`${base}/api/${res.resource}/${encodeURIComponent(String(id))}?includedetails=true`, { headers });
    if (!getRes.ok) {
      out.error = `get HTTP ${getRes.status}`;
      Object.assign(out, describeShape(first));
      return out;
    }
    const detail = (await getRes.json()) as Record<string, unknown>;
    Object.assign(out, describeShape(detail));
  } catch (err) {
    out.error = (err as Error).message;
  }
  return out;
}

function yesNo(value: boolean | undefined): string {
  if (value === undefined) return "pending";
  return value ? "Yes" : "No";
}

function render(results: Map<string, LiveResult>, specSummary?: string): string {
  const prefixes = toolPrefixes();
  const lines: string[] = [];
  const total = CONFIG_RESOURCES.length;
  const inOriginal = CONFIG_RESOURCES.filter((r) => ORIGINAL_REPO_RESOURCES.has(r.resource)).length;
  lines.push("# Coverage matrix");
  lines.push("");
  lines.push(`Configuration resources assessed: ${total}. In the original repo: ${inOriginal}. Missing from the original repo: ${total - inOriginal}.`);
  lines.push("");
  if (specSummary) lines.push(specSummary, "");
  if (results.size === 0) {
    lines.push("> **Live columns pending.** This version was generated without access to the trial instance.");
    lines.push("> Run `npx tsx scripts/coverage-matrix.ts --live` with the trial credentials set to fill in the");
    lines.push("> List, Get, Create or update, Delete and Records columns and the field name appendix.");
    lines.push("");
  }
  lines.push("Known findings from the first assessment (version 2.250.x trial): 83 resources writable, 13 read only.");
  lines.push("Field names only are recorded here; no record values.");
  lines.push("");
  lines.push("Every resource below has list and get tools; writable resources also have upsert (with dry run) and, when enabled, delete.");
  lines.push("Higher level tools: `halo_ticket_type_layout_get` / `_set`, `halo_field_group_get` / `_set`, `halo_reports_run`,");
  lines.push("`halo_reports_clone`, `halo_report_groups_list` / `_create`, `halo_dashboard_build`, plus `halo_schema_get` and");
  lines.push("`halo_config_probe` for diagnosis. Areas marked \"needs a closer look\" can be checked with `halo_config_probe`");
  lines.push("(shape only, no values) and listed with extra query parameters through `extra_params`.");
  lines.push("");

  for (const area of CONFIG_AREAS) {
    lines.push(`## ${area}`);
    lines.push("");
    lines.push("| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const res of CONFIG_RESOURCES.filter((r) => r.area === area)) {
      const live = results.get(res.resource);
      const m = live?.methods;
      const write = res.readOnly ? "No (read only)" : yesNo(m?.post);
      const nested = live?.nested ? Object.keys(live.nested).join(", ") || "none" : "pending";
      const tool = prefixes.get(res.resource.toLowerCase());
      const notes = [tool ? `Tools: \`${tool}\`` : undefined, res.notes, live?.error].filter(Boolean).join("; ");
      lines.push(
        `| ${res.resource} | ${res.uiPath} | \`/api/${res.resource}\` | ${yesNo(m?.list)} | ${yesNo(m?.get)} | ${write} | ${yesNo(m?.delete)} | ${live?.records ?? "pending"} | ${nested} | ${ORIGINAL_REPO_RESOURCES.has(res.resource) ? "Yes" : "No"} | ${notes} |`
      );
    }
    lines.push("");
  }

  lines.push("## Appendix: field names per resource");
  lines.push("");
  if (results.size === 0) {
    lines.push("Pending a live run.");
  } else {
    for (const res of CONFIG_RESOURCES) {
      const live = results.get(res.resource);
      if (!live?.fields) continue;
      lines.push(`### ${res.resource}`);
      lines.push("");
      lines.push(live.fields.map((f) => `\`${f}\``).join(", "));
      for (const [key, children] of Object.entries(live.nested ?? {})) {
        lines.push("");
        lines.push(`* \`${key}\`: ${children.map((f) => `\`${f}\``).join(", ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  configureProxy();
  const results = new Map<string, LiveResult>();
  let specSummary: string | undefined;

  if (live) {
    const base = env("BASE_URL")?.replace(/\/+$/, "");
    if (!base) throw new Error(`Set HALO_${instanceArg.toUpperCase()}_BASE_URL (or HALO_BASE_URL) for --live`);
    const token = await getToken(base);
    const specRes = await fetch(`${base}/api/swagger/v2/swagger.json`, { headers: { Authorization: `Bearer ${token}` } });
    let methods = new Map<string, Methods>();
    if (specRes.ok) {
      const spec = (await specRes.json()) as { openapi?: string; paths?: Record<string, Record<string, unknown>> };
      methods = methodsFromSpec(spec);
      specSummary = `API spec: OpenAPI ${spec.openapi ?? "unknown"}, ${Object.keys(spec.paths ?? {}).length} paths, ${methods.size} resources.`;
    }
    for (const res of CONFIG_RESOURCES) {
      results.set(res.resource, await probe(base, token, res, methods.get(res.resource.toLowerCase())));
      process.stderr.write(".");
    }
    process.stderr.write("\n");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, render(results, specSummary));
  process.stderr.write(`Wrote ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
});
