/**
 * HaloForge MCP | Tool reference generator
 *
 *   npx tsx scripts/tools-doc.ts      writes docs/tools.md
 *
 * Built from the tool definitions themselves, so arguments never drift from
 * the code. Every tool also accepts the optional `instance` argument.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { allToolDefinitions } from "../src/tools/registry.js";
import { ToolDefinition } from "../src/tools/resource-factory.js";

type AnyZod = z.ZodTypeAny;

function unwrap(t: AnyZod): { inner: AnyZod; optional: boolean } {
  let inner = t;
  let optional = false;
  for (;;) {
    if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
      optional = true;
      inner = inner.unwrap();
    } else if (inner instanceof z.ZodDefault) {
      optional = true;
      inner = inner._def.innerType;
    } else if (inner instanceof z.ZodEffects) {
      inner = inner.innerType();
    } else break;
  }
  return { inner, optional };
}

function typeName(t: AnyZod): string {
  const { inner } = unwrap(t);
  if (inner instanceof z.ZodString) return "string";
  if (inner instanceof z.ZodNumber) return "integer";
  if (inner instanceof z.ZodBoolean) return "boolean";
  if (inner instanceof z.ZodEnum) return (inner.options as string[]).map((o) => `"${o}"`).join(" or ");
  if (inner instanceof z.ZodArray) return `list of ${typeName(inner.element)}`;
  if (inner instanceof z.ZodUnion) return (inner.options as AnyZod[]).map(typeName).join(" or ");
  if (inner instanceof z.ZodRecord) return "object";
  if (inner instanceof z.ZodObject) return "object";
  return "any";
}

function describe(t: AnyZod): string {
  return (t.description ?? unwrap(t).inner.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function argsTable(tool: ToolDefinition, skip: Set<string> = new Set()): string[] {
  const rows = Object.entries(tool.inputSchema.shape).filter(([k]) => !skip.has(k));
  if (rows.length === 0) return ["No arguments (other than `instance`).", ""];
  const out = ["| Argument | Type | Required | Description |", "|---|---|---|---|"];
  for (const [name, schema] of rows) {
    const t = schema as AnyZod;
    out.push(`| \`${name}\` | ${typeName(t)} | ${unwrap(t).optional ? "no" : "yes"} | ${describe(t)} |`);
  }
  out.push("");
  return out;
}

/** Hand written examples for the higher level tools. Placeholder names only. */
const EXAMPLES: Record<string, unknown> = {
  halo_api_request: { method: "GET", path: "/Lookup", query: { lookupid: 41 } },
  halo_instances_list: {},
  halo_ticket_type_layout_get: { ticket_type_id: 12 },
  halo_ticket_type_layout_set: {
    ticket_type_id: 12,
    changes: [{ field_name: "MCP TEST | Reason", group_name: "Details", seq: 4, techdetail: 1 }, { fieldid: 205, remove: true }],
    order: { fields: ["summary", "details", "MCP TEST | Reason"] },
    dry_run: true,
  },
  halo_field_group_get: { id: 3 },
  halo_field_group_set: {
    id: 3,
    settings: { name: "MCP TEST | Details (v2)" },
    changes: [{ fieldid: 205, group_visibility_conditions: "<condition>", group_visibility_conditions_value: "1" }],
    dry_run: true,
  },
  halo_reports_run: { id: 30, count_by: "Team", sample_rows: 5 },
  halo_reports_clone: { id: 30, name: "MCP TEST | Open by team (copy)", group: "MCP TEST | Service desk", overrides: { charttype: 6 }, dry_run: true },
  halo_report_groups_list: {},
  halo_report_groups_create: { names: ["MCP TEST | Service desk"], dry_run: true },
  halo_dashboard_build: {
    name: "MCP TEST | Service desk",
    widgets: [
      { title: "Open by team", type: "report_chart", report_id: 30, x: 0, y: 0, w: 8, h: 4 },
      { title: "Open tickets", type: "ticket_counter", x: 8, y: 0, w: 4, h: 2 },
    ],
    dry_run: true,
  },
  halo_schema_get: { resource: "FieldGroup", field_filter: "visibility" },
  halo_config_probe: { resource: "Automation" },
  halo_config_export: { areas: ["Reporting"], folder: "trial_reporting" },
  halo_config_compare: { source_export: "trial_reporting", target_instance: "prod", areas: ["Reporting"] },
  halo_config_copy: {
    source_instance: "trial",
    target_instance: "prod",
    items: [{ resource: "ReportGroup", name: "MCP TEST | Service desk" }, { resource: "DashboardLinks", name: "MCP TEST | Service desk" }],
  },
  halo_config_document: { areas: ["Tickets and layout", "Service levels"], file: "handover/configuration.md" },
  halo_agents_me: {},
  halo_tickets_sla_detail: { id: 1001 },
};

const CRUD = /^halo_(.+)_(list|get|upsert|delete)$/;

function main(): void {
  const tools = allToolDefinitions();
  const crud = new Map<string, { resource: string; ops: Map<string, ToolDefinition> }>();
  const special: ToolDefinition[] = [];
  for (const t of tools) {
    const m = t.name.match(CRUD);
    if (m && !EXAMPLES[t.name]) {
      const entry = crud.get(m[1]) ?? { resource: (t.resources ?? [m[1]])[0], ops: new Map() };
      entry.ops.set(m[2], t);
      crud.set(m[1], entry);
    } else special.push(t);
  }

  const L: string[] = [];
  L.push("# Tool reference", "");
  L.push(`HaloForge MCP defines ${tools.length} tools. This file is generated by \`npx tsx scripts/tools-doc.ts\`; do not edit it by hand.`, "");
  L.push("Which tools are registered depends on the safety settings: read tools always; create and update tools when an instance is in `write` or `full` mode; delete tools only in `full` mode with `HALO_DISABLE_DELETE=false`. `HALO_TOOLS` and `HALO_TOOLS_EXCLUDE` narrow the list further.", "");
  L.push("Every tool also accepts `instance` (string, optional): the configured instance to use. The default is the first configured instance or `HALO_DEFAULT_INSTANCE`. `halo_config_copy` writes to `target_instance` instead.", "");
  L.push("## Contents", "");
  L.push("* [Higher level and general tools](#higher-level-and-general-tools)");
  L.push("* [Resource tools: common arguments](#resource-tools-common-arguments)");
  L.push("* [Resource tools by resource](#resource-tools-by-resource)", "");

  L.push("## Higher level and general tools", "");
  for (const t of special) {
    L.push(`### ${t.name}`, "");
    L.push(`${t.description}`, "");
    L.push(`Access: ${t.access}${t.supportsDryRun ? `; supports dry run${t.dryRunByDefault ? " (dry run by default)" : ""}` : ""}.`, "");
    L.push(...argsTable(t));
    const ex = EXAMPLES[t.name];
    if (ex !== undefined) L.push("Example:", "", "```json", JSON.stringify(ex, null, 2), "```", "");
  }

  const sample = crud.get("fieldgroup") ?? [...crud.values()][0];
  L.push("## Resource tools: common arguments", "");
  L.push("Each resource has up to four tools. The arguments below are shared; some resources add filters, listed in the next section.", "");
  const opInfo: Record<string, { title: string; example: unknown }> = {
    list: { title: "`halo_<resource>_list`", example: { fields: ["id", "name"], all_pages: true, max_items: 500 } },
    get: { title: "`halo_<resource>_get`", example: { id: 3, includedetails: true, fields: ["id", "name", "fields"] } },
    upsert: {
      title: "`halo_<resource>_upsert`",
      example: { data: { id: 3, fields: [{ fieldid: 205, seq: 2 }, { fieldid: 206, _remove: true }] }, dry_run: true },
    },
    delete: { title: "`halo_<resource>_delete`", example: { id: 3 } },
  };
  for (const op of ["list", "get", "upsert", "delete"]) {
    const t = sample.ops.get(op);
    if (!t) continue;
    L.push(`### ${opInfo[op].title}`, "");
    L.push(t.description.replace(/field group/g, "<resource>"), "");
    L.push(...argsTable(t));
    L.push(`Example (${t.name}):`, "", "```json", JSON.stringify(opInfo[op].example, null, 2), "```", "");
  }
  L.push("Upsert notes: include `id` to update and omit it to create; a list sends one API call. Nested arrays are merged by match key (`_remove: true` takes an item out); `merge: false` sends data as given. Updates that change nothing are skipped. Every saved write is recorded in the audit log.", "");

  L.push("## Resource tools by resource", "");
  L.push("| Resource | API path | Tools | Extra arguments |", "|---|---|---|---|");
  const common = new Set([
    ...Object.keys(sample.ops.get("list")?.inputSchema.shape ?? {}),
    ...Object.keys(sample.ops.get("get")?.inputSchema.shape ?? {}),
    ...Object.keys(sample.ops.get("upsert")?.inputSchema.shape ?? {}),
    ...Object.keys(sample.ops.get("delete")?.inputSchema.shape ?? {}),
  ]);
  for (const [prefix, entry] of [...crud.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const names = ["list", "get", "upsert", "delete"].filter((o) => entry.ops.has(o)).map((o) => `\`halo_${prefix}_${o}\``);
    const extras = new Set<string>();
    for (const [op, t] of entry.ops) {
      for (const k of Object.keys(t.inputSchema.shape)) if (!common.has(k)) extras.add(`${k} (${op})`);
    }
    L.push(`| ${entry.resource} | \`/api/${entry.resource}\` | ${names.join(", ")} | ${[...extras].map((e) => `\`${e.split(" ")[0]}\` ${e.split(" ")[1]}`).join(", ") || ""} |`);
  }
  L.push("");
  writeFileSync(resolve("docs/tools.md"), L.join("\n"));
  process.stderr.write(`Wrote docs/tools.md (${tools.length} tools)\n`);
}

main();
