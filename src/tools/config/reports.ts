/**
 * HaloForge MCP | Reports and report groups
 *
 * halo_reports_run      run a report and summarise its rows
 * halo_reports_clone    copy a report with overrides (name, SQL, group, chart settings)
 * halo_report_groups_*  report groups, which Halo keeps in lookup 41
 */

import { z } from "zod";
import { HaloClient } from "../../client/halo-client.js";
import {
  PlannedWrite,
  ToolDefinition,
  errorResult,
  executeWrites,
  extraParamsSchema,
  listRecords,
  readCurrent,
  successResult,
} from "../resource-factory.js";
import { diffRecord } from "../../safety/diff.js";

type Obj = Record<string, unknown>;

export const REPORT_GROUP_LOOKUP_ID = 41;

/** Keys that identify a record and must not be copied into a clone. */
const IDENTITY_KEYS = new Set(["id", "guid", "uniqueid", "datecreated", "createdby", "datelastmodified", "lastmodifiedby"]);

/** Candidate keys for a report's group, in order of preference. */
export const REPORT_GROUP_KEYS = ["group_id", "reportgroup_id", "report_group_id", "groupid"];

/** Known chart settings on a report. */
export const CHART_KEYS = [
  "charttype", "xaxis", "yaxis", "xaxiscaption", "yaxiscaption", "count", "graphorderby", "graphorder",
  "filterbarsbyfield", "show_datavalues", "colourpallette",
];

/** Halo rejects custom SQL containing -- comments. */
export function checkSql(record: Obj): string | null {
  for (const [k, v] of Object.entries(record)) {
    if (/sql|query/i.test(k) && typeof v === "string" && v.includes("--")) {
      return `${k} contains a -- comment, which Halo rejects. Remove it or use /* */ instead.`;
    }
  }
  return null;
}

/** The rows of a run report, wherever Halo puts them. */
export function reportRows(data: unknown): Obj[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Obj;
  const report = d.report as Obj | undefined;
  const rows = report?.rows ?? d.rows;
  return Array.isArray(rows) ? (rows as Obj[]) : undefined;
}

export function valueCounts(rows: Obj[], column: string, max: number): { distinct: number; counts: Array<{ value: unknown; count: number }> } {
  const counts = new Map<string, { value: unknown; count: number }>();
  for (const row of rows) {
    const v = row[column];
    const k = JSON.stringify(v ?? null);
    const entry = counts.get(k) ?? { value: v ?? null, count: 0 };
    entry.count++;
    counts.set(k, entry);
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  return { distinct: sorted.length, counts: sorted.slice(0, max) };
}

export async function listReportGroups(client: HaloClient): Promise<Array<{ id: number; name: string }>> {
  const result = await listRecords(client, "/Lookup", { params: { lookupid: REPORT_GROUP_LOOKUP_ID, page_size: 100 }, allPages: true, maxItems: 5000 });
  return result.records
    .filter((r): r is Obj => Boolean(r) && typeof r === "object")
    .map((r) => ({ id: Number(r.id), name: String(r.name ?? r.value ?? r.id) }));
}

export function createReportTools(): ToolDefinition[] {
  const run: ToolDefinition = {
    name: "halo_reports_run",
    description:
      "Run a report and summarise the result: row count, columns, sample rows and, for a chosen column, the count of rows per value.",
    inputSchema: z.object({
      id: z.number().int().describe("Report ID"),
      count_by: z.string().max(200).optional().describe("Column to count rows per value for"),
      sample_rows: z.number().int().min(0).max(200).optional().describe("Rows to include as a sample (default 5)"),
      max_values: z.number().int().min(1).max(1000).optional().describe("Maximum distinct values to list for count_by (default 50)"),
      ...extraParamsSchema,
    }),
    access: "read",
    resources: ["Report"],
    handler: async (args, ctx) => {
      try {
        const id = args.id as number;
        const params: Obj = { ...((args.extra_params as Obj) ?? {}), loadreport: true };
        const response = await ctx.client.get("/Report", id, params);
        const rows = reportRows(response.data);
        if (!rows) {
          return errorResult(`Report ${id} returned no rows array (expected report.rows). Check the report runs in Halo.`);
        }
        const columns = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r ?? {})))];
        const data = response.data as Obj;
        const report = (data.report as Obj | undefined) ?? {};
        const out: Obj = {
          instance: ctx.config.name,
          report: { id: data.id ?? id, name: data.name ?? report.name },
          row_count: rows.length,
          columns,
          sample_rows: rows.slice(0, (args.sample_rows as number | undefined) ?? 5),
        };
        const column = args.count_by as string | undefined;
        if (column) {
          if (!columns.includes(column)) return errorResult(`Column "${column}" is not in the report. Columns: ${columns.join(", ")}`);
          out.count_by = { column, ...valueCounts(rows, column, (args.max_values as number | undefined) ?? 50) };
        }
        return successResult(out);
      } catch (err) {
        return errorResult(`Failed to run report: ${(err as Error).message}`);
      }
    },
  };

  const clone: ToolDefinition = {
    name: "halo_reports_clone",
    description:
      "Copy a report with overrides such as a new name, SQL, report group (by ID or name) or chart settings " +
      `(${CHART_KEYS.join(", ")}). The source is unchanged. Use dry_run: true to see the new report first.`,
    inputSchema: z.object({
      id: z.number().int().describe("Report ID to copy"),
      name: z.string().min(1).max(250).describe("Name of the new report"),
      group: z.union([z.number().int(), z.string().max(250)]).optional().describe("Report group ID or name (lookup 41)"),
      overrides: z.record(z.unknown()).optional().describe("Any other values to set on the copy, for example SQL or chart settings"),
      dry_run: z.boolean().optional().describe("Preview the new report without saving"),
      show_payload: z.boolean().optional().describe("Include the exact payload in the result"),
    }),
    access: "write",
    supportsDryRun: true,
    resources: ["Report", "reports"],
    handler: async (args, ctx) => {
      try {
        const source = await readCurrent(ctx.client, "/Report", args.id as number);
        const copy: Obj = {};
        for (const [k, v] of Object.entries(source)) {
          if (!IDENTITY_KEYS.has(k.toLowerCase())) copy[k] = v;
        }
        delete copy.report; // run results, if present
        Object.assign(copy, (args.overrides as Obj) ?? {}, { name: args.name });

        const warnings: string[] = [];
        if (args.group !== undefined) {
          let groupId: number;
          if (typeof args.group === "number" || /^\d+$/.test(String(args.group))) groupId = Number(args.group);
          else {
            const groups = await listReportGroups(ctx.client);
            const match = groups.filter((g) => g.name.toLowerCase() === String(args.group).toLowerCase());
            if (match.length !== 1) return errorResult(`Report group "${args.group}" ${match.length ? "is ambiguous" : "was not found"}`);
            groupId = match[0].id;
          }
          const key = REPORT_GROUP_KEYS.find((k) => k in source);
          if (!key) return errorResult(`Could not tell which field holds the report group (looked for ${REPORT_GROUP_KEYS.join(", ")}). Set it with overrides instead.`);
          copy[key] = groupId;
        }
        const sqlProblem = checkSql(copy);
        if (sqlProblem) return errorResult(sqlProblem);
        if (/[-–—]/.test(String(args.name))) warnings.push("The name contains a hyphen or dash; brackets or | are preferred.");

        const plan: PlannedWrite = { action: "create", name: copy.name, payload: copy, changes: diffRecord(undefined, copy), warnings };
        const result = await executeWrites(ctx, "/Report", [plan], {
          dryRun: args.dry_run === true,
          showPayload: args.show_payload === true,
          resourceLabel: "Report",
        });
        return successResult({ source: { id: source.id, name: source.name }, ...result });
      } catch (err) {
        return errorResult(`Failed to clone report: ${(err as Error).message}`);
      }
    },
  };

  const groupsList: ToolDefinition = {
    name: "halo_report_groups_list",
    description: `List report groups (Halo lookup ${REPORT_GROUP_LOOKUP_ID}).`,
    inputSchema: z.object({}),
    access: "read",
    resources: ["Lookup"],
    handler: async (_args, ctx) => {
      try {
        const groups = await listReportGroups(ctx.client);
        return successResult({ instance: ctx.config.name, count: groups.length, groups });
      } catch (err) {
        return errorResult(`Failed to list report groups: ${(err as Error).message}`);
      }
    },
  };

  const groupsCreate: ToolDefinition = {
    name: "halo_report_groups_create",
    description: `Create report groups (Halo lookup ${REPORT_GROUP_LOOKUP_ID}). Names that already exist are skipped, so it is safe to repeat.`,
    inputSchema: z.object({
      names: z.array(z.string().min(1).max(250)).min(1).max(50).describe("Report group names"),
      dry_run: z.boolean().optional().describe("Preview without saving"),
    }),
    access: "write",
    supportsDryRun: true,
    resources: ["Lookup", "lookup"],
    handler: async (args, ctx) => {
      try {
        const existing = await listReportGroups(ctx.client);
        const have = new Map(existing.map((g) => [g.name.toLowerCase(), g]));
        const names = [...new Set((args.names as string[]).map((n) => n.trim()))];
        const skipped = names.filter((n) => have.has(n.toLowerCase())).map((n) => have.get(n.toLowerCase())!);
        const plans: PlannedWrite[] = names
          .filter((n) => !have.has(n.toLowerCase()))
          .map((name) => {
            const payload = { lookupid: REPORT_GROUP_LOOKUP_ID, name };
            return { action: "create", name, payload, changes: diffRecord(undefined, payload), warnings: [] };
          });
        if (plans.length === 0) return successResult({ instance: ctx.config.name, saved: false, message: "Every group already exists.", existing: skipped });
        const result = await executeWrites(ctx, "/Lookup", plans, { dryRun: args.dry_run === true, resourceLabel: "Lookup" });
        return successResult({ ...result, already_existed: skipped });
      } catch (err) {
        return errorResult(`Failed to create report groups: ${(err as Error).message}`);
      }
    },
  };

  return [run, clone, groupsList, groupsCreate];
}
