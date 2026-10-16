/**
 * HaloForge MCP | Copy configuration between instances
 *
 * halo_config_copy copies chosen objects from one instance to another. It is
 * a dry run unless dry_run: false is passed, and always returns the full plan
 * first: every object in order, whether it will be created, updated or
 * skipped, and how each reference was mapped.
 *
 * References are mapped by name: report groups (lookup 41), teams, agents,
 * statuses, fields, ticket types, SLAs, priorities, workflows, field groups
 * and reports (including report IDs in dashboard widgets). Objects created
 * earlier in the same copy are used for later references, so a report group,
 * its reports and a dashboard can be copied together. A copy is refused while
 * any reference cannot be mapped, unless allow_unresolved is set.
 */

import { z } from "zod";
import { HaloClient } from "../client/halo-client.js";
import {
  PlannedWrite,
  ToolContext,
  ToolDefinition,
  errorResult,
  executeWrites,
  readCurrent,
  successResult,
} from "../tools/resource-factory.js";
import { diffRecord } from "../safety/diff.js";
import { isPlainObject } from "../safety/merge.js";
import { isSensitiveKey } from "../utils/secrets.js";
import { REPORT_GROUP_KEYS, REPORT_GROUP_LOOKUP_ID } from "../tools/config/reports.js";
import { widgetKeyOf } from "../tools/config/dashboards.js";
import { IDENTITY_KEYS, Obj, fetchRecords, nameOf } from "./common.js";

/** Reference keys and the resource they point at. */
export const REFERENCE_KEYS: Record<string, string> = {
  team_id: "Team",
  agent_id: "Agent",
  status_id: "Status",
  fieldid: "FieldInfo",
  field_id: "FieldInfo",
  tickettype_id: "TicketType",
  requesttype_id: "TicketType",
  sla_id: "SLA",
  priority_id: "Priority",
  workflow_id: "Workflow",
  groupid: "FieldGroup",
  report_id: "Report",
  reportid: "Report",
};

const REPORT_GROUP = "ReportGroup";

/** Copy order: dependencies first. */
const ORDER: Record<string, number> = { [REPORT_GROUP]: 0, FieldInfo: 1, FieldGroup: 2, Report: 3, DashboardLinks: 5 };

interface Step {
  resource: string;
  source: Obj;
  name: string;
  reason: string;
}

interface Mapping {
  key: string;
  type: string;
  source_id: unknown;
  name?: string;
  target_id?: unknown;
  status: "mapped" | "planned" | "unresolved" | "kept";
}

/** Names of records by ID on one side, and IDs by name on the other, loaded as needed. */
class NameIndex {
  private bySourceId = new Map<string, Map<string, string>>();
  private byTargetName = new Map<string, Map<string, unknown>>();
  /** Objects this copy will create: type and lower case name to placeholder or new ID */
  readonly planned = new Map<string, unknown>();
  /** Reference types that could not be read */
  readonly errors = new Set<string>();

  constructor(private source: HaloClient, private target: HaloClient) {}

  private async load(client: HaloClient, type: string): Promise<Obj[]> {
    if (type === REPORT_GROUP) {
      return (await fetchRecords(client, "Lookup", { params: { lookupid: REPORT_GROUP_LOOKUP_ID }, maxItems: 5000 })).records;
    }
    const result = await fetchRecords(client, type, { maxItems: 20_000 });
    // A type that cannot be read leaves its references unresolved, which blocks the copy
    if (result.error) this.errors.add(`${type}: ${result.error}`);
    return result.records;
  }

  async sourceName(type: string, id: unknown): Promise<string | undefined> {
    if (!this.bySourceId.has(type)) {
      const map = new Map<string, string>();
      for (const r of await this.load(this.source, type)) {
        const n = nameOf(r);
        if (n) map.set(String(r.id), n);
      }
      this.bySourceId.set(type, map);
    }
    return this.bySourceId.get(type)!.get(String(id));
  }

  async targetId(type: string, name: string): Promise<unknown> {
    const planned = this.planned.get(`${type}|${name.toLowerCase()}`);
    if (planned !== undefined) return planned;
    if (!this.byTargetName.has(type)) {
      const map = new Map<string, unknown>();
      for (const r of await this.load(this.target, type)) {
        const n = nameOf(r);
        if (n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), r.id);
      }
      this.byTargetName.set(type, map);
    }
    return this.byTargetName.get(type)!.get(name.toLowerCase());
  }

  /** Forget a type's target index after objects of that type are created. */
  reset(type: string): void {
    this.byTargetName.delete(type);
  }
}

function isPlaceholder(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("(new) ");
}

/** Map every reference in a record. Returns the payload and a log of each mapping. */
export async function mapReferences(record: Obj, resource: string, index: NameIndex): Promise<{ payload: Obj; mappings: Mapping[] }> {
  const mappings: Mapping[] = [];
  const groupKeys = resource === "Report" ? new Set(REPORT_GROUP_KEYS) : new Set<string>();

  const walk = async (value: unknown, path: string, top: boolean): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map((v, i) => walk(v, `${path}[${i}]`, false)));
    if (!isPlainObject(value)) return value;
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      if (top && IDENTITY_KEYS.has(lower)) continue;
      if (isSensitiveKey(k)) continue;
      const type = groupKeys.has(lower) && top ? REPORT_GROUP : REFERENCE_KEYS[lower];
      const id = Number(v);
      if (type && v !== null && v !== undefined && v !== "" && Number.isFinite(id)) {
        const p = path ? `${path}.${k}` : k;
        if (id <= 0) {
          mappings.push({ key: p, type, source_id: v, status: "kept" });
          out[k] = v;
          continue;
        }
        const name = await index.sourceName(type, v);
        const target = name ? await index.targetId(type, name) : undefined;
        if (target === undefined) {
          mappings.push({ key: p, type, source_id: v, name, status: "unresolved" });
          out[k] = v;
        } else {
          mappings.push({ key: p, type, source_id: v, name, target_id: target, status: isPlaceholder(target) ? "planned" : "mapped" });
          out[k] = target;
        }
        continue;
      }
      out[k] = await walk(v, path ? `${path}.${k}` : k, false);
    }
    return out;
  };

  const payload = (await walk(record, "", true)) as Obj;
  if (resource === "DashboardLinks") stripWidgetIds(payload);
  return { payload, mappings };
}

/** New dashboards get new widgets: drop widget IDs and point the layouts at the new keys. */
function stripWidgetIds(dashboard: Obj): void {
  const key = widgetKeyOf(dashboard);
  const widgets = dashboard[key];
  if (!Array.isArray(widgets)) return;
  const renamed = new Map<string, string>();
  dashboard[key] = widgets.map((w, n) => {
    if (!isPlainObject(w)) return w;
    const { id, guid: _guid, ...rest } = w;
    void _guid;
    if (id !== undefined) renamed.set(String(id), `new${n}`);
    return rest;
  });
  if (typeof dashboard.layouts === "string" && renamed.size) {
    try {
      const layouts = JSON.parse(dashboard.layouts) as Record<string, Array<Obj>>;
      for (const items of Object.values(layouts)) {
        if (Array.isArray(items)) for (const item of items) if (renamed.has(String(item.i))) item.i = renamed.get(String(item.i));
      }
      dashboard.layouts = JSON.stringify(layouts);
    } catch {
      // leave layouts as they are
    }
  }
}

const itemSchema = z.object({
  resource: z.string().max(100).describe("API resource, for example Report, DashboardLinks, TicketType; or ReportGroup for a report group"),
  id: z.union([z.number().int(), z.string().max(100)]).optional().describe("Source record ID"),
  name: z.string().max(250).optional().describe("Source record name, instead of id"),
});

function apiPathOf(resource: string): string {
  return resource === REPORT_GROUP ? "/Lookup" : `/${resource}`;
}

async function findSource(client: HaloClient, resource: string, item: { id?: unknown; name?: string }): Promise<Obj> {
  if (resource === REPORT_GROUP) {
    const groups = (await fetchRecords(client, "Lookup", { params: { lookupid: REPORT_GROUP_LOOKUP_ID }, maxItems: 5000 })).records;
    const match = groups.filter((g) => (item.id !== undefined ? String(g.id) === String(item.id) : nameOf(g)?.toLowerCase() === item.name?.toLowerCase()));
    if (match.length !== 1) throw new Error(`Report group ${item.id ?? `"${item.name}"`} ${match.length ? "is ambiguous" : "was not found"} on the source`);
    return { ...match[0], lookupid: match[0].lookupid ?? REPORT_GROUP_LOOKUP_ID };
  }
  let id = item.id;
  if (id === undefined) {
    const all = (await fetchRecords(client, resource, { maxItems: 20_000 })).records;
    const match = all.filter((r) => nameOf(r)?.toLowerCase() === item.name?.toLowerCase());
    if (match.length !== 1) throw new Error(`${resource} "${item.name}" ${match.length ? "is ambiguous" : "was not found"} on the source`);
    id = match[0].id;
  }
  return readCurrent(client, `/${resource}`, id as number);
}

/** Collect the objects to copy, with dependencies, in copy order. */
async function collectSteps(client: HaloClient, items: Array<{ resource: string; id?: unknown; name?: string }>, withDeps: boolean, withReports: boolean): Promise<Step[]> {
  const steps: Step[] = [];
  const seen = new Set<string>();
  const add = (resource: string, source: Obj, reason: string) => {
    const key = `${resource}|${source.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    steps.push({ resource, source, name: nameOf(source) ?? String(source.id), reason });
  };

  for (const item of items) {
    const resource = item.resource.toLowerCase() === "reportgroup" ? REPORT_GROUP : item.resource;
    if (resource !== REPORT_GROUP && !/^[A-Za-z0-9_]+$/.test(resource)) throw new Error(`"${item.resource}" is not a resource name`);
    const source = await findSource(client, resource, item);
    add(resource, source, "requested");

    if (resource === REPORT_GROUP && withReports) {
      const reports = (await fetchRecords(client, "Report", { maxItems: 20_000 })).records;
      for (const r of reports) {
        const key = REPORT_GROUP_KEYS.find((k) => k in r);
        if (key && String(r[key]) === String(source.id)) add("Report", await readCurrent(client, "/Report", r.id as number), `in report group "${nameOf(source)}"`);
      }
    }
  }

  if (withDeps) {
    for (const step of [...steps]) {
      if (step.resource === "DashboardLinks") {
        const widgets = step.source[widgetKeyOf(step.source)];
        for (const w of Array.isArray(widgets) ? widgets : []) {
          const rid = isPlainObject(w) ? (w.report_id ?? w.reportid) : undefined;
          if (rid !== undefined && Number(rid) > 0) add("Report", await readCurrent(client, "/Report", rid as number), `used by dashboard "${step.name}"`);
        }
      }
    }
    for (const step of [...steps]) {
      if (step.resource === "Report") {
        const key = REPORT_GROUP_KEYS.find((k) => k in step.source);
        const gid = key ? step.source[key] : undefined;
        if (gid !== undefined && Number(gid) > 0) {
          try {
            add(REPORT_GROUP, await findSource(client, REPORT_GROUP, { id: gid }), `group of report "${step.name}"`);
          } catch {
            // reported as an unresolved reference instead
          }
        }
      }
    }
  }
  return steps.sort((a, b) => (ORDER[a.resource] ?? 4) - (ORDER[b.resource] ?? 4));
}

export function createCopyTool(): ToolDefinition {
  return {
    name: "halo_config_copy",
    description:
      "Copy configuration objects from one instance to another, for example a report group with its reports plus a dashboard. " +
      "References (report groups, teams, agents, statuses, fields, reports in dashboard widgets and more) are mapped by name. " +
      "Dry run by default: returns the full plan without saving. Pass dry_run: false to apply; this is refused while any reference is unresolved.",
    inputSchema: z.object({
      source_instance: z.string().max(64).describe("Instance to copy from"),
      target_instance: z.string().max(64).describe("Instance to copy to"),
      items: z.array(itemSchema).min(1).max(50).describe("Objects to copy"),
      include_dependencies: z.boolean().optional().describe("Also copy reports used by dashboards and the groups of copied reports (default true)"),
      include_group_reports: z.boolean().optional().describe("When copying a report group, also copy its reports (default true)"),
      on_existing: z.enum(["skip", "update"]).optional().describe("When the target already has an object of the same name: skip it (default) or update it to match"),
      allow_unresolved: z.boolean().optional().describe("Apply even if some references could not be mapped (they keep the source ID)"),
      dry_run: z.boolean().optional().describe("Default true. Pass false to apply the plan"),
    }),
    access: "write",
    supportsDryRun: true,
    dryRunByDefault: true,
    targetInstanceArg: "target_instance",
    accessFor: (args) => ({
      access: "write",
      resources: [...new Set(((args.items as Array<{ resource: string }>) ?? []).map((i) => (i.resource.toLowerCase() === "reportgroup" ? "Lookup" : i.resource)))],
    }),
    handler: async (args, ctx) => handleCopy(args, ctx),
  };
}

async function handleCopy(args: Record<string, unknown>, ctx: ToolContext) {
  try {
    const source = ctx.manager.resolve(args.source_instance as string);
    const target = { client: ctx.client, config: ctx.config };
    if (source.config.name === target.config.name) return errorResult("Source and target are the same instance");
    const dryRun = args.dry_run !== false;
    const onExisting = (args.on_existing as string | undefined) ?? "skip";

    const steps = await collectSteps(
      source.client,
      args.items as Array<{ resource: string; id?: unknown; name?: string }>,
      args.include_dependencies !== false,
      args.include_group_reports !== false
    );
    const index = new NameIndex(source.client, target.client);

    interface PlanRow extends Obj {
      step: number;
      resource: string;
      name: string;
      reason: string;
      action: "create" | "update" | "skip";
      source_id: unknown;
      target_id?: unknown;
    }
    const plan: PlanRow[] = [];
    const prepared: Array<{ row: PlanRow; step: Step; write?: PlannedWrite }> = [];
    let unresolved = 0;

    for (const step of steps) {
      const existingId = await index.targetId(step.resource, step.name);
      const row: PlanRow = {
        step: plan.length + 1,
        resource: step.resource === REPORT_GROUP ? "ReportGroup (Lookup 41)" : step.resource,
        name: step.name,
        reason: step.reason,
        action: existingId !== undefined && !isPlaceholder(existingId) ? (onExisting === "update" ? "update" : "skip") : "create",
        source_id: step.source.id,
        ...(existingId !== undefined && !isPlaceholder(existingId) ? { target_id: existingId } : {}),
      };
      plan.push(row);
      if (row.action === "skip") {
        prepared.push({ row, step });
        continue;
      }
      const { payload, mappings } = await mapReferences(step.source, step.resource, index);
      if (step.resource === REPORT_GROUP) payload.lookupid = REPORT_GROUP_LOOKUP_ID;
      const bad = mappings.filter((m) => m.status === "unresolved");
      unresolved += bad.length;
      row.references = mappings.filter((m) => m.status !== "kept").map((m) => ({
        field: m.key,
        type: m.type === REPORT_GROUP ? "ReportGroup" : m.type,
        source_id: m.source_id,
        name: m.name ?? null,
        target_id: m.target_id ?? null,
        status: m.status,
      }));
      let write: PlannedWrite;
      if (row.action === "update") {
        const current = await readCurrent(target.client, apiPathOf(step.resource), row.target_id as number);
        const full = { ...payload, id: row.target_id };
        write = { action: "update", id: row.target_id as number, name: step.name, payload: full, changes: diffRecord(current, full), warnings: [] };
      } else {
        write = { action: "create", name: step.name, payload, changes: diffRecord(undefined, payload), warnings: [] };
        index.planned.set(`${step.resource}|${step.name.toLowerCase()}`, `(new) ${step.name}`);
      }
      row.change_count = write.changes.length;
      if (bad.length) row.warning = `${bad.length} reference(s) could not be mapped by name; they would keep the source ID`;
      prepared.push({ row, step, write });
    }

    const summary = {
      create: plan.filter((p) => p.action === "create").length,
      update: plan.filter((p) => p.action === "update").length,
      skip: plan.filter((p) => p.action === "skip").length,
      unresolved_references: unresolved,
    };

    if (dryRun) {
      return successResult({
        ...(index.errors.size ? { lookup_errors: [...index.errors] } : {}),
        dry_run: true,
        saved: false,
        source: source.config.name,
        target: target.config.name,
        summary,
        plan,
        notice: unresolved
          ? "Nothing was saved. Some references could not be mapped by name: create them on the target first, or pass allow_unresolved: true."
          : "Nothing was saved. Run again with dry_run: false to apply this plan.",
      });
    }
    if (unresolved && args.allow_unresolved !== true) {
      return errorResult(`Refusing to copy: ${unresolved} reference(s) could not be mapped by name. Run a dry run to see them, or pass allow_unresolved: true.`);
    }

    // Apply in order, feeding new IDs into later references
    const applied: Obj[] = [];
    for (const { row, step, write } of prepared) {
      if (!write) {
        applied.push({ step: row.step, resource: row.resource, name: row.name, action: "skip", target_id: row.target_id });
        continue;
      }
      let payload = write.payload;
      if (write.action === "create" || Object.values(payload).some(isPlaceholder) || JSON.stringify(payload).includes('"(new) ')) {
        const remapped = await mapReferences(step.source, step.resource, index);
        payload = write.action === "update" ? { ...remapped.payload, id: write.id } : remapped.payload;
        if (step.resource === REPORT_GROUP) payload.lookupid = REPORT_GROUP_LOOKUP_ID;
        if (JSON.stringify(payload).includes('"(new) ')) throw new Error(`Step ${row.step} still refers to an object that was not created`);
      }
      const result = await executeWrites(ctx, apiPathOf(step.resource), [{ ...write, payload }], { dryRun: false, resourceLabel: step.resource });
      const item = (result.items as Obj[] | undefined)?.[0];
      const newId = item?.id ?? write.id;
      if (write.action === "create" && newId !== undefined) {
        index.planned.set(`${step.resource}|${step.name.toLowerCase()}`, newId);
      }
      applied.push({ step: row.step, resource: row.resource, name: row.name, action: write.action, target_id: newId, saved: result.saved });
    }
    return successResult({ dry_run: false, saved: true, source: source.config.name, target: target.config.name, summary, applied });
  } catch (err) {
    return errorResult(`Copy failed: ${(err as Error).message}`);
  }
}
